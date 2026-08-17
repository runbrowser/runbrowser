/**
 * Buffered CDP event endpoints.
 *
 * POST /api/events/drain   — take what has arrived since the last drain
 * POST /api/events/filter  — restrict what the buffer retains
 *
 * Two routes rather than a wait vocabulary. A caller that can read the event
 * tail can build its own waits — for a navigation, a dialog, a download, the
 * network going quiet — and each of those as a named verb would be a guess at
 * which conditions matter.
 */

import type { Hono } from 'hono'
import type { ServerContext } from '../server-context.js'

export function registerApiEventRoutes(app: Hono, ctx: ServerContext) {
  app.post('/api/events/drain', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string | number
      peek?: boolean
    }
    const sessionId = ctx.normalizeSessionId(body.sessionId)
    if (!sessionId) return c.json({ error: 'sessionId is required' }, 400)

    const buffer = ctx.eventBuffers.get(sessionId)
    return c.json(body.peek ? buffer.peek() : buffer.drain())
  })

  app.post('/api/events/filter', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string | number
      pattern?: string | null
    }
    const sessionId = ctx.normalizeSessionId(body.sessionId)
    if (!sessionId) return c.json({ error: 'sessionId is required' }, 400)

    const buffer = ctx.eventBuffers.get(sessionId)
    try {
      buffer.setFilter(body.pattern ?? null)
    } catch (error: any) {
      // An invalid pattern would otherwise fail later, on an unrelated call.
      return c.json({ error: `Invalid filter: ${error.message}` }, 400)
    }
    return c.json({ filter: buffer.getFilter(), buffered: buffer.size })
  })
}
