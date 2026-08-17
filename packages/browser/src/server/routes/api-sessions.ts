/**
 * Session management API endpoints.
 *
 * /api/execute, /api/reset, /api/sessions, /api/session/*
 */

import type { Hono } from 'hono'
import type { ServerContext } from '../server-context.js'

export function registerApiSessionRoutes(app: Hono, ctx: ServerContext) {
  app.post('/api/execute', async (c) => {
    try {
      const body = (await c.req.json()) as { sessionId: string | number; code: string; timeout?: number }
      const sessionId = ctx.normalizeSessionId(body.sessionId)
      const { code, timeout = 10000 } = body

      if (!sessionId || !code) {
        return c.json({ error: 'sessionId and code are required' }, 400)
      }

      const executor = ctx.executorManager.getSession(sessionId)
      if (!executor) {
        return c.json(
          { text: `Session ${sessionId} not found. Run 'termio-browser session-new' first.`, images: [], isError: true },
          404,
        )
      }
      const result = await executor.execute(code, timeout)
      return c.json(result)
    } catch (error: any) {
      ctx.logger?.error('Execute endpoint error:', error)
      return c.json({ text: `Server error: ${error.message}`, images: [], isError: true }, 500)
    }
  })

  app.post('/api/reset', async (c) => {
    try {
      const body = (await c.req.json()) as { sessionId: string | number }
      const sessionId = ctx.normalizeSessionId(body.sessionId)

      if (!sessionId) {
        return c.json({ error: 'sessionId is required' }, 400)
      }

      const executor = ctx.executorManager.getSession(sessionId)
      if (!executor) {
        return c.json({ error: `Session ${sessionId} not found. Run 'termio-browser session-new' first.` }, 404)
      }
      const { page, context } = await executor.reset()

      return c.json({
        success: true,
        pageUrl: page.url(),
        pagesCount: context.pages().length,
      })
    } catch (error: any) {
      ctx.logger?.error('Reset endpoint error:', error)
      return c.json({ error: error.message }, 500)
    }
  })

  app.get('/api/sessions', async (c) => {
    return c.json({ sessions: ctx.executorManager.listSessions() })
  })

  app.get('/api/session/suggest', (c) => {
    return c.json({ next: ctx.nextSessionNumber.value })
  })

  app.post('/api/session/new', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { extensionId?: string | null; cwd?: string }
    const sessionId = String(ctx.nextSessionNumber.value++)
    const extensionId = body.extensionId || null
    const cwd = body.cwd
    const allowDefault = !extensionId && ctx.store.getState().extensions.size === 1
    const conn = ctx.getExtensionConnection(extensionId, { allowFallback: allowDefault })
    if (!conn) {
      // Three different situations reach here, and telling a user with no
      // extension installed that "multiple extensions" are connected sends
      // them looking for the wrong problem.
      const connected = ctx.store.getState().extensions.size
      const error = extensionId
        ? `Extension not connected: ${extensionId}`
        : connected === 0
          ? 'No browser connected. Install the termio browser extension and click its icon on a tab.'
          : 'Multiple browsers connected. Pass extensionId to choose one.'
      return c.json({ error }, 404)
    }
    const executor = ctx.executorManager.getExecutor({
      sessionId,
      cwd,
      sessionMetadata: {
        extensionId: conn.stableKey,
        browser: conn.info.browser || null,
        profile: conn.info ? { email: conn.info.email || '', id: conn.info.id || '' } : null,
      },
    })
    const metadata = executor.getSessionMetadata()
    return c.json({
      id: sessionId,
      extensionId: metadata.extensionId,
      browser: metadata.browser,
      profile: metadata.profile,
    })
  })

  app.get('/api/session/:id', async (c) => {
    const sessionId = c.req.param('id')
    const executor = ctx.executorManager.getSession(sessionId)
    if (!executor) {
      return c.json({ error: 'not found' }, 404)
    }
    const metadata = executor.getSessionMetadata()
    return c.json({
      id: sessionId,
      extensionId: metadata.extensionId,
      browser: metadata.browser,
      profile: metadata.profile,
    })
  })

  app.post('/api/session/delete', async (c) => {
    try {
      const body = (await c.req.json()) as { sessionId: string | number }
      const sessionId = ctx.normalizeSessionId(body.sessionId)

      if (!sessionId) {
        return c.json({ error: 'sessionId is required' }, 400)
      }

      const deleted = ctx.executorManager.deleteExecutor(sessionId)
      if (!deleted) {
        return c.json({ error: `Session ${sessionId} not found` }, 404)
      }
      return c.json({ success: true })
    } catch (error: any) {
      ctx.logger?.error('Delete session endpoint error:', error)
      return c.json({ error: error.message }, 500)
    }
  })
}
