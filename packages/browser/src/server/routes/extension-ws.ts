/**
 * Extension WebSocket endpoint (/extension).
 *
 * Handles the WebSocket connection from the Chrome extension.
 * Processes CDP events, target lifecycle, and extension messages.
 */

import type { Hono } from 'hono'
import type { Protocol } from '../cdp-types.js'
import type { CDPEventBase, CDPEventFor } from '../cdp-types.js'
import type {
  ExtensionMessage,
  ExtensionEventMessage,
} from '../protocol.js'
import type { ServerContext } from '../server-context.js'
import { logCdpMessage } from '../server-context.js'
import { isRestrictedTarget } from '../target-filter.js'
import { EXTENSION_IDS } from '../utils.js'
import * as relayState from '../state.js'
import pc from 'picocolors'

export function registerExtensionWsRoute(
  app: Hono,
  ctx: ServerContext,
  upgradeWebSocket: ReturnType<typeof import('hono/bun').createBunWebSocket>['upgradeWebSocket'],
  remoteAddress: (c: any) => string | undefined,
) {
  const getExtensionInfoFromRequest = (c: {
    req: { query: (name: string) => string | undefined }
  }): relayState.ExtensionInfo => {
    const browser = c.req.query('browser')
    const email = c.req.query('email')
    const id = c.req.query('id')
    const version = c.req.query('v')
    return {
      browser: browser || undefined,
      email: email || undefined,
      id: id || undefined,
      version: version || undefined,
    }
  }

  app.get(
    '/extension',
    // Auth middleware: extension must be local + from our extension ID
    (c, next) => {
      const address = remoteAddress(c)
      const isLocalhost = !address || address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'

      if (!isLocalhost) {
        ctx.logger?.log(pc.red(`Rejecting /extension WebSocket from remote IP: ${address}`))
        return c.text('Forbidden - Extension must be local', 403)
      }

      const origin = c.req.header('origin')
      if (!origin || !origin.startsWith('chrome-extension://')) {
        ctx.logger?.log(
          pc.red(`Rejecting /extension WebSocket: origin must be chrome-extension://, got: ${origin || 'none'}`),
        )
        return c.text('Forbidden', 403)
      }

      const extensionId = origin.replace('chrome-extension://', '')
      if (!EXTENSION_IDS.includes(extensionId)) {
        ctx.logger?.log(pc.red(`Rejecting /extension WebSocket from unknown extension: ${extensionId}`))
        return c.text('Forbidden', 403)
      }

      return next()
    },
    upgradeWebSocket((c: any) => {
      const incomingExtensionInfo = getExtensionInfoFromRequest(c)
      const connectionId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

      return {
        onOpen(_event: any, ws: any) {
          const stableKey = ctx.buildStableExtensionKey(incomingExtensionInfo, connectionId)

          // Check for existing connection with same stableKey and close it
          const existingExt = relayState.findExtensionByStableKey(ctx.store.getState(), stableKey)
          if (existingExt && existingExt.id !== connectionId) {
            ctx.logger?.log(
              pc.yellow(`Replacing extension connection for ${stableKey} (${existingExt.id} -> ${connectionId})`),
            )
            if (existingExt.ws) {
              existingExt.ws.close(4001, 'Extension Replaced')
            }
          }

          ctx.store.setState((s) =>
            relayState.addExtension(s, {
              id: connectionId,
              info: incomingExtensionInfo,
              stableKey,
              ws,
            }),
          )

          ctx.startExtensionPing(connectionId)
          ctx.logger?.log(`Extension connected (${connectionId})`)
        },

        async onMessage(event: any, ws: any) {
          const ext = ctx.store.getState().extensions.get(connectionId)
          if (!ext) {
            ws.close(1000, 'Extension not registered')
            return
          }

          let message: ExtensionMessage
          try {
            message = JSON.parse(event.data.toString())
          } catch {
            ws.close(1000, 'Invalid JSON')
            return
          }

          // Response to a pending request
          if (message.id !== undefined) {
            handleExtensionResponse(ctx, connectionId, message)
            return
          }

          // Dispatch by method
          switch (message.method) {
            case 'pong':
              break // Keep-alive response
            case 'log':
              handleExtensionLog(ctx, message)
              break
            case 'forwardCDPEvent':
              handleCDPEvent(ctx, connectionId, message as ExtensionEventMessage)
              break
          }
        },

        onClose(event: any) {
          ctx.logger?.log(
            `Extension disconnected: code=${event.code} reason=${event.reason || 'none'} (${connectionId})`,
          )

          // Reject all pending I/O requests
          const closingExt = ctx.store.getState().extensions.get(connectionId)
          if (closingExt) {
            ctx.stopExtensionPing(connectionId)
            for (const pending of closingExt.pendingRequests.values()) {
              pending.reject(new Error('Extension connection closed'))
            }
          }

          // Check for successor with same stableKey
          const currentRelayState = ctx.store.getState()
          const closingExtension = currentRelayState.extensions.get(connectionId)
          const successorExtension = closingExtension
            ? Array.from(currentRelayState.extensions.values())
                .reverse()
                .find(
                  (ext) =>
                    ext.id !== connectionId &&
                    ext.stableKey === closingExtension.stableKey &&
                    Boolean(ext.ws),
                )
            : undefined

          if (successorExtension) {
            ctx.logger?.log(
              pc.yellow(
                `Rebinding clients from ${connectionId} to ${successorExtension.id} (stableKey: ${successorExtension.stableKey})`,
              ),
            )
            ctx.store.setState((s) =>
              relayState.rebindClientsToExtension(s, {
                fromExtensionId: connectionId,
                toExtensionId: successorExtension.id,
              }),
            )
          }

          // Close playwright clients bound to this extension when no successor exists
          if (!successorExtension) {
            const { playwrightClients } = ctx.store.getState()
            for (const client of playwrightClients.values()) {
              if (client.extensionId === connectionId) {
                client.ws.close(1000, 'Extension disconnected')
              }
            }
          }

          // State transition: remove extension + its bound clients atomically
          ctx.store.setState((s) => relayState.removeExtension(s, { extensionId: connectionId }))
        },

        onError(event: any) {
          ctx.logger?.error('Extension WebSocket error:', event)
        },
      }
    }),
  )
}

// ============================================================================
// Message handlers
// ============================================================================

function handleExtensionResponse(
  ctx: ServerContext,
  connectionId: string,
  message: { id: number; result?: unknown; error?: string },
) {
  let pendingRequest: relayState.ExtensionPendingRequest | null = null

  ctx.store.setState((s) => {
    const extensionEntry = s.extensions.get(connectionId)
    if (!extensionEntry) return s

    const nextPendingRequest = extensionEntry.pendingRequests.get(message.id)
    if (!nextPendingRequest) return s

    pendingRequest = nextPendingRequest
    return relayState.removeExtensionPendingRequest(s, {
      extensionId: connectionId,
      requestId: message.id,
    })
  })

  const pending = pendingRequest as relayState.ExtensionPendingRequest | null
  if (!pending) {
    ctx.logger?.log('Unexpected response with id:', message.id)
    return
  }

  if (message.error) {
    pending.reject(new Error(message.error))
  } else {
    pending.resolve(message.result)
  }
}

function handleExtensionLog(ctx: ServerContext, message: any) {
  const { level, args } = message.params
  const logFn =
    (ctx.logger as Record<string, unknown>)?.[level] as ((...args: unknown[]) => void) | undefined
  const logFunc = logFn || ctx.logger?.log
  const prefix = pc.yellow(`[Extension] [${level.toUpperCase()}]`)
  logFunc?.(prefix, ...args)
}

function handleCDPEvent(
  ctx: ServerContext,
  connectionId: string,
  extensionEvent: ExtensionEventMessage,
) {
  const { method, params, sessionId } = extensionEvent.params

  ctx.logCdpJson({
    timestamp: new Date().toISOString(),
    direction: 'from-extension',
    message: { method, params, sessionId },
  })

  logCdpMessage(ctx.logger, {
    direction: 'from-extension',
    method,
    sessionId,
    params,
  })

  const cdpEvent: CDPEventBase = { method, sessionId, params }
  ctx.emitter.emit('cdp:event', { event: cdpEvent, sessionId })

  // Dispatch by CDP method
  switch (method) {
    case 'Target.attachedToTarget':
      handleTargetAttached(ctx, connectionId, params as Protocol.Target.AttachedToTargetEvent, sessionId)
      break
    case 'Target.detachedFromTarget':
      handleTargetDetached(ctx, connectionId, params as Protocol.Target.DetachedFromTargetEvent)
      break
    case 'Target.targetCrashed':
      handleTargetCrashed(ctx, connectionId, params as Protocol.Target.TargetCrashedEvent)
      break
    case 'Target.targetInfoChanged':
      handleTargetInfoChanged(ctx, connectionId, params as Protocol.Target.TargetInfoChangedEvent)
      break
    case 'Page.frameAttached':
      handleFrameAttached(ctx, connectionId, params as Protocol.Page.FrameAttachedEvent, sessionId)
      break
    case 'Page.frameDetached':
      handleFrameDetached(ctx, connectionId, params as Protocol.Page.FrameDetachedEvent, sessionId, method)
      break
    case 'Page.frameNavigated':
      handleFrameNavigated(ctx, connectionId, params as Protocol.Page.FrameNavigatedEvent, sessionId, method)
      break
    case 'Page.navigatedWithinDocument':
      handleNavigatedWithinDocument(ctx, connectionId, params as Protocol.Page.NavigatedWithinDocumentEvent, sessionId, method)
      break
    default:
      // Forward all other events to Playwright
      ctx.sendToPlaywright({
        message: { sessionId, method, params } as CDPEventBase,
        source: 'extension',
        extensionId: connectionId,
      })
  }
}

// ============================================================================
// CDP event handlers
// ============================================================================

function handleTargetAttached(
  ctx: ServerContext,
  connectionId: string,
  targetParams: Protocol.Target.AttachedToTargetEvent,
  incomingSessionId?: string,
) {
  const iframeParentFrameId = targetParams.targetInfo.parentFrameId
  const currentExtState = ctx.store.getState().extensions.get(connectionId)
  const iframeOwnerSessionId =
    targetParams.targetInfo.type === 'iframe' && iframeParentFrameId && currentExtState
      ? ctx.getPageTargetForFrameId({ extensionState: currentExtState, frameId: iframeParentFrameId })?.sessionId
      : undefined

  if (isRestrictedTarget(targetParams.targetInfo)) {
    if (targetParams.waitingForDebugger && targetParams.sessionId) {
      void ctx.sendToExtension({
        extensionId: connectionId,
        method: 'forwardCDPCommand',
        params: {
          sessionId: targetParams.sessionId,
          method: 'Runtime.runIfWaitingForDebugger',
          params: {},
          source: 'server',
        },
      }).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error)
        ctx.logger?.log(pc.yellow('[Server] Failed to resume restricted target:'), msg)
      })
    }
    ctx.logger?.log(
      pc.gray(
        `[Server] Ignoring restricted target: ${targetParams.targetInfo.type} (${targetParams.targetInfo.url})`,
      ),
    )
    return
  }

  if (!targetParams.targetInfo.url) {
    ctx.logger?.error(
      pc.red('[Extension] WARNING: Target.attachedToTarget received with empty URL!'),
      JSON.stringify({ method: 'Target.attachedToTarget', params: targetParams, sessionId: incomingSessionId }),
    )
  }
  ctx.logger?.log(
    pc.yellow('[Extension] Target.attachedToTarget full payload:'),
    JSON.stringify({ method: 'Target.attachedToTarget', params: targetParams, sessionId: incomingSessionId }),
  )

  const alreadyConnected = currentExtState?.connectedTargets.has(targetParams.sessionId) ?? false

  ctx.store.setState((s) =>
    relayState.addTarget(s, {
      extensionId: connectionId,
      sessionId: targetParams.sessionId,
      targetId: targetParams.targetInfo.targetId,
      targetInfo: targetParams.targetInfo,
    }),
  )

  if (!alreadyConnected) {
    ctx.sendToPlaywright({
      message: {
        sessionId: iframeOwnerSessionId ?? incomingSessionId,
        method: 'Target.attachedToTarget',
        params: targetParams,
      } as CDPEventBase,
      source: 'extension',
      extensionId: connectionId,
    })
  }
}

function handleTargetDetached(
  ctx: ServerContext,
  connectionId: string,
  detachParams: Protocol.Target.DetachedFromTargetEvent,
) {
  ctx.store.setState((s) =>
    relayState.removeTarget(s, { extensionId: connectionId, sessionId: detachParams.sessionId }),
  )
  ctx.sendToPlaywright({
    message: { method: 'Target.detachedFromTarget', params: detachParams } as CDPEventBase,
    source: 'extension',
    extensionId: connectionId,
  })
}

function handleTargetCrashed(
  ctx: ServerContext,
  connectionId: string,
  crashParams: Protocol.Target.TargetCrashedEvent,
) {
  ctx.store.setState((s) =>
    relayState.removeTargetByCrash(s, { extensionId: connectionId, targetId: crashParams.targetId }),
  )
  ctx.logger?.log(pc.red('[Server] Target crashed, removing:'), crashParams.targetId)
  ctx.sendToPlaywright({
    message: { method: 'Target.targetCrashed', params: crashParams } as CDPEventBase,
    source: 'extension',
    extensionId: connectionId,
  })
}

function handleTargetInfoChanged(
  ctx: ServerContext,
  connectionId: string,
  infoParams: Protocol.Target.TargetInfoChangedEvent,
) {
  ctx.store.setState((s) =>
    relayState.updateTargetInfo(s, { extensionId: connectionId, targetInfo: infoParams.targetInfo }),
  )
  ctx.sendToPlaywright({
    message: { method: 'Target.targetInfoChanged', params: infoParams } as CDPEventBase,
    source: 'extension',
    extensionId: connectionId,
  })
}

function handleFrameAttached(
  ctx: ServerContext,
  connectionId: string,
  frameParams: Protocol.Page.FrameAttachedEvent,
  sessionId?: string,
) {
  if (sessionId) {
    ctx.store.setState((s) =>
      relayState.addFrameId(s, { extensionId: connectionId, sessionId, frameId: frameParams.frameId }),
    )
  }
  ctx.sendToPlaywright({
    message: { sessionId, method: 'Page.frameAttached', params: frameParams } as CDPEventBase,
    source: 'extension',
    extensionId: connectionId,
  })
}

function handleFrameDetached(
  ctx: ServerContext,
  connectionId: string,
  frameParams: Protocol.Page.FrameDetachedEvent,
  sessionId?: string,
  method?: string,
) {
  ctx.store.setState((s) =>
    relayState.removeFrameId(s, { extensionId: connectionId, frameId: frameParams.frameId }),
  )
  ctx.sendToPlaywright({
    message: { sessionId, method: method || 'Page.frameDetached', params: frameParams } as CDPEventBase,
    source: 'extension',
    extensionId: connectionId,
  })
}

function handleFrameNavigated(
  ctx: ServerContext,
  connectionId: string,
  frameParams: Protocol.Page.FrameNavigatedEvent,
  sessionId?: string,
  method?: string,
) {
  if (sessionId) {
    ctx.store.setState((s) =>
      relayState.addFrameId(s, { extensionId: connectionId, sessionId, frameId: frameParams.frame.id }),
    )
  }
  if (!frameParams.frame.parentId && sessionId) {
    ctx.store.setState((s) =>
      relayState.updateTargetUrl(s, {
        extensionId: connectionId,
        sessionId,
        url: frameParams.frame.url,
        title: frameParams.frame.name || undefined,
      }),
    )
    ctx.logger?.log(
      pc.magenta('[Server] Updated target URL from Page.frameNavigated:'),
      frameParams.frame.url,
    )
  }
  ctx.sendToPlaywright({
    message: { sessionId, method: method || 'Page.frameNavigated', params: frameParams } as CDPEventBase,
    source: 'extension',
    extensionId: connectionId,
  })
}

function handleNavigatedWithinDocument(
  ctx: ServerContext,
  connectionId: string,
  navParams: Protocol.Page.NavigatedWithinDocumentEvent,
  sessionId?: string,
  method?: string,
) {
  if (sessionId) {
    ctx.store.setState((s) =>
      relayState.updateTargetUrl(s, { extensionId: connectionId, sessionId, url: navParams.url }),
    )
    ctx.logger?.log(
      pc.magenta('[Server] Updated target URL from Page.navigatedWithinDocument:'),
      navParams.url,
    )
  }
  ctx.sendToPlaywright({
    message: { sessionId, method: method || 'Page.navigatedWithinDocument', params: navParams } as CDPEventBase,
    source: 'extension',
    extensionId: connectionId,
  })
}
