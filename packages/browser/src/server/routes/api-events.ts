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

import type { Routes } from '../http.js'
import { readJson } from '../http.js'
import type { ServerContext } from '../server-context.js'

export function apiEventRoutes(ctx: ServerContext): Routes {
  return {
    '/api/events/drain': {
      POST: async (request) => {
        const body = await readJson<{ sessionId: string | number; peek?: boolean }>(request, {
          sessionId: '',
        })
        const sessionId = ctx.normalizeSessionId(body.sessionId)
        if (!sessionId) {
          return Response.json({ error: 'sessionId is required' }, { status: 400 })
        }

        const buffer = ctx.eventBuffers.get(sessionId)
        const result = body.peek ? buffer.peek() : buffer.drain()
        return Response.json(result)
      },
    },

    '/api/events/filter': {
      POST: async (request) => {
        const body = await readJson<{ sessionId: string | number; pattern?: string | null }>(
          request,
          { sessionId: '' },
        )
        const sessionId = ctx.normalizeSessionId(body.sessionId)
        if (!sessionId) {
          return Response.json({ error: 'sessionId is required' }, { status: 400 })
        }

        const buffer = ctx.eventBuffers.get(sessionId)
        try {
          buffer.setFilter(body.pattern ?? null)
        } catch (error: any) {
          // An invalid pattern would otherwise fail later, on an unrelated call.
          return Response.json({ error: `Invalid filter: ${error.message}` }, { status: 400 })
        }
        return Response.json({ filter: buffer.getFilter(), buffered: buffer.size })
      },
    },
  }
}
