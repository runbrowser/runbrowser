/**
 * Browser API endpoints.
 *
 * Four routes, and only one of them touches the page. Everything a caller
 * might want to do to a document — click, type, read, screenshot — is a CDP
 * method and goes through /api/cdp. Adding a named route per action rebuilds
 * the wrapper layer this server deliberately does not have.
 */

import type { Hono } from 'hono'
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
  app: Hono,
  ctx: ServerContext,
  path: string,
  options: {
    required?: string[]
    handler: CommandHandler<T>
  },
) {
  app.post(path, async (c) => {
    try {
      const body = (await c.req.json()) as T & { sessionId: string | number }
      const sessionId = ctx.normalizeSessionId(body.sessionId)
      if (!sessionId) return c.json({ error: 'sessionId is required' }, 400)

      if (options.required) {
        for (const key of options.required) {
          if ((body as any)[key] == null) {
            return c.json({ error: `${key} is required` }, 400)
          }
        }
      }

      const executor = ctx.getCDPExecutor(sessionId)
      if (!executor) return c.json({ error: `Session ${sessionId} not found` }, 404)

      const result = await options.handler(executor, body)
      return c.json(result ?? { success: true })
    } catch (error: any) {
      return c.json({ error: error.message }, 500)
    }
  })
}

// ============================================================================
// Route registration
// ============================================================================

export function registerApiCommandRoutes(app: Hono, ctx: ServerContext) {
  // The page API.
  commandRoute(app, ctx, '/api/cdp', {
    required: ['method'],
    handler: async (exec, { method, params }) => ({ result: await exec.rawCDP(method, params) }),
  })

  // Runtime.evaluate with result marshalling, kept because reading a value out
  // of the page is the single most common call and the raw shape is awkward.
  commandRoute(app, ctx, '/api/evaluate', {
    required: ['code'],
    handler: (exec, { code, timeout }) => exec.execute(code, timeout ?? 10000),
  })

  // Connection state: which targets exist and which one this session is on.
  commandRoute(app, ctx, '/api/tab/list', {
    handler: async (exec) => ({ tabs: await exec.listTabs() }),
  })

  commandRoute(app, ctx, '/api/tab/new', {
    handler: async (exec, { url }) => exec.newTab(url),
  })

  // Addressed by target id, not list position: Target.getTargets makes no
  // ordering guarantee, so an index captured in one call can name a different
  // tab in the next. The CLI resolves index -> targetId for humans.
  commandRoute(app, ctx, '/api/tab/switch', {
    required: ['targetId'],
    handler: async (exec, { targetId }) => exec.switchTab(targetId).then(() => ({ success: true })),
  })

  commandRoute(app, ctx, '/api/tab/close', {
    handler: async (exec, { targetId }) => exec.closeTab(targetId).then(() => ({ success: true })),
  })
}
