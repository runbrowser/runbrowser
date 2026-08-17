/**
 * Runtime adapter for the Hono app.
 *
 * The app itself is runtime-agnostic; only three things differ between Bun and
 * Node — how a WebSocket upgrade is produced, how the peer address is read, and
 * how the server is started. Keeping that difference in one file is the reason
 * this is worth doing at all: the relay ships on Bun, and the e2e suite drives
 * it from Node because Playwright is not supported under Bun. Same source, both
 * ways, chosen at startup.
 */

import type { Hono } from 'hono'
import type { UpgradeWebSocket } from 'hono/ws'

export type RuntimeAdapter = {
  name: 'bun' | 'node'
  upgradeWebSocket: UpgradeWebSocket
  /** Peer address, or undefined when the runtime cannot report one. */
  remoteAddress(c: any): string | undefined
  listen(options: { port: number; host: string }): { close(): void }
}

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'

export async function createRuntimeAdapter(app: Hono): Promise<RuntimeAdapter> {
  if (isBun) {
    const { createBunWebSocket, getConnInfo } = await import('hono/bun')
    const { upgradeWebSocket, websocket } = createBunWebSocket()

    return {
      name: 'bun',
      upgradeWebSocket,
      remoteAddress(c) {
        try {
          return getConnInfo(c).remote.address
        } catch {
          return undefined
        }
      },
      listen({ port, host }) {
        const server = (globalThis as any).Bun.serve({
          fetch: app.fetch,
          port,
          hostname: host,
          websocket,
        })
        return { close: () => server.stop(true) }
      },
    }
  }

  const { serve } = await import('@hono/node-server')
  const { createNodeWebSocket } = await import('@hono/node-ws')
  const { getConnInfo } = await import('@hono/node-server/conninfo')
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  return {
    name: 'node',
    upgradeWebSocket,
    remoteAddress(c) {
      try {
        return getConnInfo(c).remote.address
      } catch {
        return undefined
      }
    },
    listen({ port, host }) {
      const server = serve({ fetch: app.fetch, port, hostname: host })
      injectWebSocket(server)
      return { close: () => server.close() }
    },
  }
}
