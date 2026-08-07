/**
 * CDP Relay Server — composition root.
 *
 * Direct CDP mode: connects to Chrome's debugging WebSocket directly.
 * No Chrome extension required.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { EventEmitter } from 'node:events'
import util from 'node:util'

import type { ServerContext, Logger } from './server-context.js'
import { createCdpLogger, type CdpLogEntry, type CdpLogger } from './cdp-log.js'
import { CDPExecutorManager } from './cdp-executor-manager.js'
import * as relayState from './state.js'
import { VERSION } from './utils.js'

// Routes
import { registerCdpDiscoveryRoutes } from './routes/cdp-discovery.js'
import { registerApiCommandRoutes } from './routes/api-commands.js'
import { registerApiSessionRoutes } from './routes/api-sessions.js'
import { registerApiCustomCommandRoutes } from './routes/api-custom-commands.js'
import { createPrivilegedMiddleware } from './middleware/privileged.js'

// Prevent Buffers from dumping hex bytes in util.inspect output.
Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}

// ============================================================================
// Public types
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
    cdpUrl?: string
    sessionMetadata?: relayState.SessionMetadata
  }): ExecutorLike
  listSessions(): Array<relayState.SessionMetadata & { id: string; stateKeys: string[] }>
  deleteExecutor(sessionId: string): boolean | Promise<boolean>
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
  // Build ServerContext
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

    // Executor manager (initialized below)
    executorManager: undefined!,
    getCDPExecutor: undefined!,
  }

  // ========================================================================
  // Executor manager
  // ========================================================================

  ctx.executorManager = new CDPExecutorManager({
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

  // CORS middleware — allow all origins for direct CDP mode
  app.use('*', cors())

  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  // Security middleware for privileged routes
  const privilegedMiddleware = createPrivilegedMiddleware({ token, logger })
  app.use('/api/*', privilegedMiddleware)

  // Simple status endpoints
  app.get('/', (c) => c.text('OK'))
  app.get('/version', (c) => c.json({ version: VERSION }))

  // ========================================================================
  // Register all routes
  // ========================================================================

  registerCdpDiscoveryRoutes(app, ctx)
  registerApiSessionRoutes(app, ctx)
  registerApiCommandRoutes(app, ctx)
  registerApiCustomCommandRoutes(app, ctx)

  // ========================================================================
  // Start server
  // ========================================================================

  const server = serve({ fetch: app.fetch, port, hostname: host })
  injectWebSocket(server)

  logger?.log('CDP relay server started (direct mode)')
  logger?.log('Host:', host)
  logger?.log('Port:', port)

  return {
    close() {
      const { playwrightClients } = store.getState()
      for (const client of playwrightClients.values()) {
        client.ws.close(1000, 'Server stopped')
      }
      store.setState({ playwrightClients: new Map() })
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
