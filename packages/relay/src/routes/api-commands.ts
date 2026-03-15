/**
 * High-level browser command API endpoints.
 *
 * Uses a route factory to eliminate boilerplate — each command is a one-liner.
 */

import type { Hono } from 'hono'
import type { ServerContext } from '../server-context.js'
import type { CDPExecutor } from '../cdp-executor.js'

// ============================================================================
// Route factory — eliminates 20+ copy-paste endpoint handlers
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
    timeoutFromParams?: boolean
  },
) {
  app.post(path, async (c) => {
    try {
      const body = (await c.req.json()) as T & { sessionId: string | number }
      const sessionId = ctx.normalizeSessionId(body.sessionId)
      if (!sessionId) return c.json({ error: 'sessionId is required' }, 400)

      // Validate required fields
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
  // Navigation
  commandRoute(app, ctx, '/api/navigate', {
    required: ['url'],
    handler: (exec, { url }) => exec.navigate(url),
  })

  commandRoute(app, ctx, '/api/back', {
    handler: (exec) => exec.goBack().then(() => ({ success: true })),
  })

  commandRoute(app, ctx, '/api/forward', {
    handler: (exec) => exec.goForward().then(() => ({ success: true })),
  })

  commandRoute(app, ctx, '/api/reload', {
    handler: (exec) => exec.reload().then(() => ({ success: true })),
  })

  // Observation
  commandRoute(app, ctx, '/api/snapshot', {
    handler: async (exec, { interactiveOnly }) => {
      const result = await exec.snapshot({ interactiveOnly })
      return { snapshot: result.snapshot, refs: result.refs }
    },
  })

  commandRoute(app, ctx, '/api/screenshot', {
    handler: async (exec) => {
      const data = await exec.screenshot()
      return { data, mimeType: 'image/jpeg' }
    },
  })

  // Element interaction
  commandRoute(app, ctx, '/api/click', {
    required: ['ref'],
    handler: (exec, { ref }) => exec.click(ref).then(() => ({ success: true })),
  })

  commandRoute(app, ctx, '/api/fill', {
    required: ['ref'],
    handler: (exec, { ref, value }) => exec.fill(ref, value ?? '').then(() => ({ success: true })),
  })

  commandRoute(app, ctx, '/api/type', {
    handler: (exec, { text }) => exec.type(text ?? '').then(() => ({ success: true })),
  })

  commandRoute(app, ctx, '/api/press', {
    required: ['key'],
    handler: (exec, { key }) => exec.press(key).then(() => ({ success: true })),
  })

  commandRoute(app, ctx, '/api/scroll', {
    required: ['direction'],
    handler: (exec, { direction, amount }) =>
      exec.scroll(direction, amount).then(() => ({ success: true })),
  })

  commandRoute(app, ctx, '/api/hover', {
    required: ['ref'],
    handler: (exec, { ref }) => exec.hover(ref).then(() => ({ success: true })),
  })

  commandRoute(app, ctx, '/api/select', {
    required: ['ref'],
    handler: (exec, { ref, value }) =>
      exec.selectOption(ref, value).then(() => ({ success: true })),
  })

  commandRoute(app, ctx, '/api/viewport', {
    required: ['width', 'height'],
    handler: (exec, { width, height }) =>
      exec.viewport(width, height).then(() => ({ success: true })),
  })

  // Page info
  commandRoute(app, ctx, '/api/get-url', {
    handler: async (exec) => ({ url: await exec.getUrl() }),
  })

  commandRoute(app, ctx, '/api/get-title', {
    handler: async (exec) => ({ title: await exec.getTitle() }),
  })

  commandRoute(app, ctx, '/api/get-text', {
    required: ['ref'],
    handler: async (exec, { ref }) => ({ text: await exec.getText(ref) }),
  })

  commandRoute(app, ctx, '/api/get-html', {
    required: ['ref'],
    handler: async (exec, { ref }) => ({ html: await exec.getHtml(ref) }),
  })

  commandRoute(app, ctx, '/api/get-value', {
    required: ['ref'],
    handler: async (exec, { ref }) => ({ value: await exec.getValue(ref) }),
  })

  commandRoute(app, ctx, '/api/get-attr', {
    required: ['ref', 'attr'],
    handler: async (exec, { ref, attr }) => ({ value: await exec.getAttribute(ref, attr) }),
  })

  commandRoute(app, ctx, '/api/is-visible', {
    required: ['ref'],
    handler: async (exec, { ref }) => ({ visible: await exec.isVisible(ref) }),
  })

  commandRoute(app, ctx, '/api/is-checked', {
    required: ['ref'],
    handler: async (exec, { ref }) => ({ checked: await exec.isChecked(ref) }),
  })

  // Wait
  commandRoute(app, ctx, '/api/wait', {
    handler: async (exec, { ref, text, url, ms, load, fn, timeout }) => {
      await exec.waitFor({ ref, text, url, ms, load, fn }, timeout)
      return { success: true }
    },
  })

  // Evaluate / execute
  commandRoute(app, ctx, '/api/evaluate', {
    required: ['code'],
    handler: (exec, { code, timeout }) => exec.execute(code, timeout ?? 10000),
  })

  // Raw CDP
  commandRoute(app, ctx, '/api/cdp', {
    required: ['method'],
    handler: async (exec, { method, params }) => ({ result: await exec.rawCDP(method, params) }),
  })
}
