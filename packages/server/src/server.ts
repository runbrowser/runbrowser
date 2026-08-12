/**
 * CDP Relay Server — composition root.
 *
 * Creates the ServerContext and assembles all route handlers.
 * No business logic lives here — only wiring.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'

import { createNodeWebSocket } from '@hono/node-ws'
import { EventEmitter } from 'node:events'
import util from 'node:util'
import pc from 'picocolors'

import type { Protocol } from './cdp-types.js'
import type { CDPCommand, CDPResponseBase, CDPEventBase } from './cdp-types.js'
import type { ServerContext, Logger } from './server-context.js'
import { logCdpMessage } from './server-context.js'
import { isRestrictedTarget } from './target-filter.js'
import { createCdpLogger, type CdpLogEntry, type CdpLogger } from './cdp-log.js'
import { CDPExecutorManager } from './cdp-executor-manager.js'
import { CDPExecutor } from './cdp-executor.js'
import * as relayState from './state.js'
import { VERSION, EXTENSION_IDS } from './utils.js'

// Routes
import { registerCdpDiscoveryRoutes } from './routes/cdp-discovery.js'
import { registerApiCommandRoutes } from './routes/api-commands.js'
import { registerApiSessionRoutes } from './routes/api-sessions.js'
import { registerApiCustomCommandRoutes } from './routes/api-custom-commands.js'
import { registerExtensionWsRoute } from './routes/extension-ws.js'
import { registerPlaywrightWsRoute } from './routes/playwright-ws.js'
import { createPrivilegedMiddleware } from './middleware/privileged.js'



// Prevent Buffers from dumping hex bytes in util.inspect output.
Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}

// ============================================================================
// Public types (preserved for backwards compatibility)
// ============================================================================

export type RelayServer = {
  close(): void
  on<K extends keyof import('./cdp-types.js').RelayServerEvents>(
    event: K,
    listener: import('./cdp-types.js').RelayServerEvents[K],
  ): void
  off<K extends keyof import('./cdp-types.js').RelayServerEvents>(
    event: K,
    listener: import('./cdp-types.js').RelayServerEvents[K],
  ): void
}

export interface ExecutorManagerLike {
  getSession(sessionId: string): ExecutorLike | undefined
  getExecutor(options: {
    sessionId: string
    cwd?: string
    sessionMetadata?: relayState.SessionMetadata
  }): ExecutorLike
  listSessions(): Array<relayState.SessionMetadata & { id: string; stateKeys: string[] }>
  deleteExecutor(sessionId: string): boolean
}

export interface ExecutorLike {
  execute(
    code: string,
    timeout: number,
  ): Promise<{ text: string; images: Array<{ data: string; mimeType: string }>; isError: boolean }>
  reset(): Promise<{ page: { url(): string }; context: { pages(): any[] } }>
  getSessionMetadata(): relayState.SessionMetadata
}

// ============================================================================
// Server factory
// ============================================================================

export async function startRunBrowserCDPRelayServer({
  port = 19988,
  host = '127.0.0.1',
  token,
  logger,
  cdpLogger,
}: {
  port?: number
  host?: string
  token?: string
  logger?: Logger
  cdpLogger?: CdpLogger
} = {}): Promise<RelayServer> {
  const emitter = new EventEmitter()
  const store = relayState.createRelayStore()
  const resolvedCdpLogger = cdpLogger || createCdpLogger()

  // ========================================================================
  // Build ServerContext — all shared state in one place
  // ========================================================================

  const ctx: ServerContext = {
    store,
    emitter,
    logger,
    token,
    host,
    port,
    logCdpJson: (entry: CdpLogEntry) => resolvedCdpLogger.log(entry),
    nextSessionNumber: { value: 1 },

    normalizeSessionId(value) {
      if (value === undefined || value === null) return null
      const normalized = String(value)
      return normalized || null
    },

    getExtensionConnection(extensionId, options = {}) {
      const currentState = store.getState()
      const { extensions } = currentState

      if (extensionId) {
        const direct = extensions.get(extensionId)
        if (direct?.ws) return direct
        const byKey = relayState.findExtensionByStableKey(currentState, extensionId)
        if (byKey) {
          const candidates = Array.from(extensions.values())
            .filter((ext) => ext.stableKey === byKey.stableKey)
            .reverse()
          for (const candidate of candidates) {
            if (candidate.ws) return candidate
          }
        }
        return null
      }

      if (!options.allowFallback) return null

      // Single extension — use it directly
      if (extensions.size === 1) {
        const fallbackId = extensions.keys().next().value
        if (fallbackId) {
          const ext = extensions.get(fallbackId)
          if (ext?.ws) return ext
        }
      }

      // Multiple extensions — auto-select if exactly one has active targets (#52)
      if (extensions.size > 1) {
        const activeExtensions = Array.from(extensions.values()).filter(
          (ext) => ext.connectedTargets.size > 0,
        )
        if (activeExtensions.length === 1 && activeExtensions[0].ws) {
          return activeExtensions[0]
        }
      }

      return null
    },

    sendToPlaywright({ message, clientId, source = 'extension', extensionId }) {
      const messageToSend =
        source === 'server' && 'method' in message
          ? { ...message, __serverGenerated: true }
          : message

      ctx.logCdpJson({
        timestamp: new Date().toISOString(),
        direction: 'to-playwright',
        clientId,
        source,
        message: messageToSend,
      })

      if ('method' in message) {
        logCdpMessage(logger, {
          direction: 'to-playwright',
          clientId,
          method: message.method,
          sessionId: 'sessionId' in message ? message.sessionId : undefined,
          params: 'params' in message ? message.params : undefined,
          source,
        })
      }

      const messageStr = JSON.stringify(messageToSend)

      const safeSend = (client: relayState.PlaywrightClient) => {
        try {
          client.ws.send(messageStr)
        } catch (e) {
          logger?.log(
            pc.gray(`[Relay] Skipped sending to closing client ${client.id}: ${(e as Error).message}`),
          )
        }
      }

      if (clientId) {
        const client = store.getState().playwrightClients.get(clientId)
        if (client) safeSend(client)
      } else {
        for (const client of store.getState().playwrightClients.values()) {
          if (extensionId && client.extensionId !== extensionId) continue
          safeSend(client)
        }
      }
    },

    async sendToExtension({ extensionId, method, params, timeout = 30000 }) {
      const conn = ctx.getExtensionConnection(extensionId)
      if (!conn) throw new Error('Extension not connected')
      const resolvedExtensionId = conn.id

      let id = 0
      store.setState((s) => {
        const ext = s.extensions.get(resolvedExtensionId)
        if (!ext) return s
        id = ext.messageId + 1
        const newExtensions = new Map(s.extensions)
        newExtensions.set(resolvedExtensionId, { ...ext, messageId: id })
        return { ...s, extensions: newExtensions }
      })

      if (!id) throw new Error('Extension not connected')

      const message = { id, method, params }

      // Log CDP commands being forwarded
      if (method === 'forwardCDPCommand') {
        const fwd = params as { method?: string; sessionId?: string; params?: unknown } | undefined
        if (fwd?.method) {
          ctx.logCdpJson({
            timestamp: new Date().toISOString(),
            direction: 'to-extension',
            message: { method: fwd.method, sessionId: fwd.sessionId, params: fwd.params },
          })
        }
      }

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          store.setState((s) =>
            relayState.removeExtensionPendingRequest(s, {
              extensionId: resolvedExtensionId,
              requestId: id,
            }),
          )
          reject(new Error(`Extension request timeout after ${timeout}ms: ${method}`))
        }, timeout)

        const pendingRequest = {
          resolve: (result: unknown) => {
            clearTimeout(timeoutId)
            resolve(result)
          },
          reject: (error: Error) => {
            clearTimeout(timeoutId)
            reject(error)
          },
        }

        store.setState((s) =>
          relayState.addExtensionPendingRequest(s, {
            extensionId: resolvedExtensionId,
            requestId: id,
            pendingRequest,
          }),
        )

        const latestExt = store.getState().extensions.get(resolvedExtensionId)
        if (!latestExt?.ws) {
          clearTimeout(timeoutId)
          store.setState((s) =>
            relayState.removeExtensionPendingRequest(s, {
              extensionId: resolvedExtensionId,
              requestId: id,
            }),
          )
          reject(new Error('Extension not connected'))
          return
        }

        try {
          latestExt.ws.send(JSON.stringify(message))
        } catch (error) {
          clearTimeout(timeoutId)
          store.setState((s) =>
            relayState.removeExtensionPendingRequest(s, {
              extensionId: resolvedExtensionId,
              requestId: id,
            }),
          )
          const sendError = error instanceof Error ? error : new Error(String(error))
          reject(new Error(`Extension send failed: ${method}`, { cause: sendError }))
        }
      })
    },

    async routeCdpCommand({ extensionId, method, params, sessionId, source }) {
      const conn = ctx.getExtensionConnection(extensionId)
      const connectedTargets = conn?.connectedTargets || new Map()
      const resolvedExtensionId = conn?.id || extensionId

      switch (method) {
        case 'Browser.getVersion':
          return {
            protocolVersion: '1.3',
            product: 'Chrome/Extension-Bridge',
            revision: '1.0.0',
            userAgent: 'CDP-Bridge-Server/1.0.0',
            jsVersion: 'V8',
          } satisfies Protocol.Browser.GetVersionResponse

        case 'Browser.setDownloadBehavior':
          return {}

        case 'Target.setAutoAttach': {
          if (sessionId) break
          if (conn) await maybeAutoCreateInitialTab(ctx, conn.id)
          await ctx.sendToExtension({
            extensionId: resolvedExtensionId,
            method: 'forwardCDPCommand',
            params: { method, params, source },
          })
          return {}
        }

        case 'Target.setDiscoverTargets':
          return {}

        case 'Target.attachToTarget': {
          const attachParams = params as Protocol.Target.AttachToTargetRequest
          if (!attachParams?.targetId) {
            throw new Error('targetId is required for Target.attachToTarget')
          }
          for (const target of connectedTargets.values()) {
            if (target.targetId === attachParams.targetId) {
              return { sessionId: target.sessionId } satisfies Protocol.Target.AttachToTargetResponse
            }
          }
          throw new Error(`Target ${attachParams.targetId} not found in connected targets`)
        }

        case 'Target.getTargetInfo': {
          const infoReqParams = params as Protocol.Target.GetTargetInfoRequest | undefined
          const targetId = infoReqParams?.targetId
          if (targetId) {
            for (const target of connectedTargets.values()) {
              if (target.targetId === targetId) return { targetInfo: target.targetInfo }
            }
          }
          if (sessionId) {
            const target = connectedTargets.get(sessionId)
            if (target) return { targetInfo: target.targetInfo }
          }
          const firstTarget = Array.from(connectedTargets.values())[0]
          return { targetInfo: firstTarget?.targetInfo }
        }

        case 'Target.getTargets':
          return {
            targetInfos: Array.from(connectedTargets.values())
              .filter((t) => !isRestrictedTarget(t.targetInfo))
              .map((t) => ({ ...t.targetInfo, attached: true })),
          }

        case 'Target.createTarget':
        case 'Target.closeTarget':
          return await ctx.sendToExtension({
            extensionId: resolvedExtensionId,
            method: 'forwardCDPCommand',
            params: { method, params, source },
          })

        case 'Runtime.enable': {
          if (!sessionId) break
          const contextCreatedPromise = new Promise<void>((resolve) => {
            const handler = ({ event }: { event: CDPEventBase }) => {
              if (
                event.method === 'Runtime.executionContextCreated' &&
                event.sessionId === sessionId
              ) {
                const p = event.params as Protocol.Runtime.ExecutionContextCreatedEvent | undefined
                if (p?.context?.auxData?.isDefault === true) {
                  clearTimeout(timeout)
                  emitter.off('cdp:event', handler)
                  resolve()
                }
              }
            }
            const timeout = setTimeout(() => {
              emitter.off('cdp:event', handler)
              logger?.log(
                pc.yellow(
                  `IMPORTANT: Runtime.enable timed out waiting for main frame executionContextCreated (sessionId: ${sessionId}). This may cause pages to not be visible immediately.`,
                ),
              )
              resolve()
            }, 3000)
            emitter.on('cdp:event', handler)
          })

          const result = await ctx.sendToExtension({
            extensionId: resolvedExtensionId,
            method: 'forwardCDPCommand',
            params: { sessionId, method, params, source },
          })

          await contextCreatedPromise
          return result
        }
      }

      // Default: forward to extension
      return await ctx.sendToExtension({
        extensionId: resolvedExtensionId,
        method: 'forwardCDPCommand',
        params: { sessionId, method, params, source },
      })
    },

    buildStableExtensionKey(info, connectionId) {
      if (info.id) return `profile:${info.id}`
      if (info.email) return `email:${info.email}`
      if (info.browser) return `browser:${info.browser}`
      return `connection:${connectionId}`
    },

    startExtensionPing(extensionId) {
      const ext = store.getState().extensions.get(extensionId)
      if (!ext) return
      if (ext.pingInterval) clearInterval(ext.pingInterval)

      const pingInterval = setInterval(() => {
        const latestExt = store.getState().extensions.get(extensionId)
        latestExt?.ws?.send(JSON.stringify({ method: 'ping' }))
      }, 5000)

      store.setState((s) => relayState.updateExtensionIO(s, { extensionId, pingInterval }))
    },

    stopExtensionPing(extensionId) {
      const ext = store.getState().extensions.get(extensionId)
      if (!ext?.pingInterval) return
      clearInterval(ext.pingInterval)
      store.setState((s) =>
        relayState.updateExtensionIO(s, { extensionId, pingInterval: null }),
      )
    },

    getPageTargetForFrameId({ extensionState, frameId }) {
      return Array.from(extensionState.connectedTargets.values()).find((target) => {
        return target.targetInfo.type === 'page' && target.frameIds.has(frameId)
      })
    },

    // Executor manager (initialized immediately after ctx creation)
    executorManager: undefined!,
    getCDPExecutor: undefined!,

  }

  // ========================================================================
  // Executor manager
  // ========================================================================

  ctx.executorManager = new CDPExecutorManager({
    sendToExtension: ctx.sendToExtension,
    getExtensionEntry: (stableKeyOrId) =>
      ctx.getExtensionConnection(stableKeyOrId, { allowFallback: true }),
    registerTarget: ({ extensionId, sessionId, targetId, targetInfo }) => {
      ctx.store.setState((s) =>
        relayState.addTarget(s, { extensionId, sessionId, targetId, targetInfo }),
      )
    },
    logger,
  })

  ctx.getCDPExecutor = (sessionId: string) => {
    const executor = ctx.executorManager.getSession(sessionId)
    if (!executor) return null
    return executor as import('./cdp-executor.js').CDPExecutor
  }

  // ========================================================================
  // Hono app
  // ========================================================================

  const app = new Hono()

  // CORS middleware — only allows our specific extension IDs
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin.startsWith('chrome-extension://')) return null
        const extensionId = origin.replace('chrome-extension://', '')
        if (!EXTENSION_IDS.includes(extensionId)) return null
        return origin
      },
      allowMethods: ['GET', 'POST', 'HEAD', 'OPTIONS'],
    }),
  )

  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  // Security middleware for privileged routes
  const privilegedMiddleware = createPrivilegedMiddleware({ token, logger })
  app.use('/api/*', privilegedMiddleware)
  app.use('/recording/*', privilegedMiddleware)

  // ========================================================================
  // Register all routes
  // ========================================================================

  registerCdpDiscoveryRoutes(app, ctx)
  registerPlaywrightWsRoute(app, ctx, upgradeWebSocket)
  registerExtensionWsRoute(app, ctx, upgradeWebSocket)
  registerApiSessionRoutes(app, ctx)
  registerApiCommandRoutes(app, ctx)
  registerApiCustomCommandRoutes(app, ctx)

  // ========================================================================
  // Start server
  // ========================================================================

  const server = serve({ fetch: app.fetch, port, hostname: host })
  injectWebSocket(server)

  const wsHost = `ws://${host}:${port}`
  logger?.log('CDP relay server started')
  logger?.log('Host:', host)
  logger?.log('Port:', port)
  logger?.log('Extension endpoint:', `${wsHost}/extension`)
  logger?.log('CDP endpoint:', `${wsHost}/cdp`)

  return {
    close() {
      const { extensions, playwrightClients } = store.getState()
      for (const client of playwrightClients.values()) {
        client.ws.close(1000, 'Server stopped')
      }
      for (const ext of extensions.values()) {
        if (ext.pingInterval) clearInterval(ext.pingInterval)
        ext.ws?.close(1000, 'Server stopped')
      }
      store.setState({ extensions: new Map(), playwrightClients: new Map() })
      server.close()
      emitter.removeAllListeners()
    },
    on(event, listener) {
      emitter.on(event, listener as (...args: unknown[]) => void)
    },
    off(event, listener) {
      emitter.off(event, listener as (...args: unknown[]) => void)
    },
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function maybeAutoCreateInitialTab(ctx: ServerContext, extensionId: string): Promise<void> {
  if (!process.env.TERMIO_BROWSER_AUTO_ENABLE) return

  const conn = ctx.getExtensionConnection(extensionId)
  if (!conn) return
  if (conn.connectedTargets.size > 0) return

  try {
    ctx.logger?.log(pc.blue('Auto-creating initial tab for Playwright client'))
    const result = (await ctx.sendToExtension({
      extensionId,
      method: 'createInitialTab',
      timeout: 10000,
    })) as {
      success: boolean
      tabId: number
      sessionId: string
      targetInfo: Protocol.Target.TargetInfo
    }
    if (result.success && result.sessionId && result.targetInfo) {
      ctx.store.setState((s) =>
        relayState.addTarget(s, {
          extensionId,
          sessionId: result.sessionId,
          targetId: result.targetInfo.targetId,
          targetInfo: result.targetInfo,
        }),
      )
      const updatedTargets =
        ctx.store.getState().extensions.get(extensionId)?.connectedTargets.size || 0
      ctx.logger?.log(
        pc.blue(`Auto-created tab, now have ${updatedTargets} targets, url: ${result.targetInfo.url}`),
      )
    }
  } catch (e) {
    ctx.logger?.error('Failed to auto-create initial tab:', e)
  }
}
