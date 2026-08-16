/**
 * Browser API endpoints.
 *
 * Four routes, and only one of them touches the page. Everything a caller
 * might want to do to a document — click, type, read, screenshot — is a CDP
 * method and goes through /api/cdp. Adding a named route per action rebuilds
 * the wrapper layer this server deliberately does not have.
 */

import type { RouteEntry, Routes } from '../http.js'
import { readJson } from '../http.js'
import type { ServerContext } from '../server-context.js'
import type { CDPExecutor } from '../cdp-executor.js'

// ============================================================================
// Route factory
// ============================================================================

type CommandHandler<T = Record<string, any>> = (
  executor: CDPExecutor,
  params: T,
) => Promise<unknown>

function commandRoute<T extends Record<string, any>>(
  ctx: ServerContext,
  options: {
    required?: string[]
    handler: CommandHandler<T>
  },
): RouteEntry {
  return {
    POST: async (request) => {
      try {
        const body = await readJson<T & { sessionId: string | number }>(
          request,
          {} as T & { sessionId: string | number },
        )
        const sessionId = ctx.normalizeSessionId(body.sessionId)
        if (!sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 })

        for (const key of options.required ?? []) {
          if ((body as Record<string, unknown>)[key] == null) {
            return Response.json({ error: `${key} is required` }, { status: 400 })
          }
        }

        const executor = ctx.getCDPExecutor(sessionId)
        if (!executor) {
          return Response.json({ error: `Session ${sessionId} not found` }, { status: 404 })
        }

        const result = await options.handler(executor, body)
        return Response.json(result ?? { success: true })
      } catch (error: any) {
        return Response.json({ error: error.message }, { status: 500 })
      }
    },
  }
}

// ============================================================================
// Route table
// ============================================================================

export function apiCommandRoutes(ctx: ServerContext): Routes {
  return {
    // The page API.
    '/api/cdp': commandRoute(ctx, {
      required: ['method'],
      handler: async (exec, { method, params }) => ({ result: await exec.rawCDP(method, params) }),
    }),

    // Runtime.evaluate with result marshalling, kept because reading a value out
    // of the page is the single most common call and the raw shape is awkward.
    '/api/evaluate': commandRoute(ctx, {
      required: ['code'],
      handler: (exec, { code, timeout }) => exec.execute(code, timeout ?? 10000),
    }),

    // Connection state: which targets exist and which one this session is on.
    '/api/tab/list': commandRoute(ctx, {
      handler: async (exec) => ({ tabs: await exec.listTabs() }),
    }),

    '/api/tab/new': commandRoute(ctx, {
      handler: async (exec, { url }) => exec.newTab(url),
    }),

    // Addressed by target id, not list position: Target.getTargets makes no
    // ordering guarantee, so an index captured in one call can name a different
    // tab in the next. The CLI resolves index -> targetId for humans.
    '/api/tab/switch': commandRoute(ctx, {
      required: ['targetId'],
      handler: async (exec, { targetId }) => exec.switchTab(targetId).then(() => ({ success: true })),
    }),

    '/api/tab/close': commandRoute(ctx, {
      handler: async (exec, { targetId }) => exec.closeTab(targetId).then(() => ({ success: true })),
    }),
  }
}
