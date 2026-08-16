/**
 * Session management API endpoints.
 *
 * /api/execute, /api/reset, /api/sessions, /api/session/*
 */

import type { Routes } from '../http.js'
import { readJson } from '../http.js'
import type { ServerContext } from '../server-context.js'

export function apiSessionRoutes(ctx: ServerContext): Routes {
  return {
    '/api/execute': {
      POST: async (request) => {
        try {
          const body = await readJson<{
            sessionId: string | number
            code: string
            timeout?: number
          }>(request, { sessionId: '', code: '' })
          const sessionId = ctx.normalizeSessionId(body.sessionId)
          const { code, timeout = 10000 } = body

          if (!sessionId || !code) {
            return Response.json({ error: 'sessionId and code are required' }, { status: 400 })
          }

          const executor = ctx.executorManager.getSession(sessionId)
          if (!executor) {
            return Response.json(
              {
                text: `Session ${sessionId} not found. Run 'termio-browser session-new' first.`,
                images: [],
                isError: true,
              },
              { status: 404 },
            )
          }
          return Response.json(await executor.execute(code, timeout))
        } catch (error: any) {
          ctx.logger?.error('Execute endpoint error:', error)
          return Response.json(
            { text: `Server error: ${error.message}`, images: [], isError: true },
            { status: 500 },
          )
        }
      },
    },

    '/api/reset': {
      POST: async (request) => {
        try {
          const body = await readJson<{ sessionId: string | number }>(request, { sessionId: '' })
          const sessionId = ctx.normalizeSessionId(body.sessionId)

          if (!sessionId) {
            return Response.json({ error: 'sessionId is required' }, { status: 400 })
          }

          const executor = ctx.executorManager.getSession(sessionId)
          if (!executor) {
            return Response.json(
              { error: `Session ${sessionId} not found. Run 'termio-browser session-new' first.` },
              { status: 404 },
            )
          }
          const { page, context } = await executor.reset()

          return Response.json({
            success: true,
            pageUrl: page.url(),
            pagesCount: context.pages().length,
          })
        } catch (error: any) {
          ctx.logger?.error('Reset endpoint error:', error)
          return Response.json({ error: error.message }, { status: 500 })
        }
      },
    },

    '/api/sessions': () => Response.json({ sessions: ctx.executorManager.listSessions() }),

    '/api/session/suggest': () => Response.json({ next: ctx.nextSessionNumber.value }),

    '/api/session/new': {
      POST: async (request) => {
        const body = await readJson<{ extensionId?: string | null; cwd?: string }>(request, {})
        const sessionId = String(ctx.nextSessionNumber.value++)
        const extensionId = body.extensionId || null
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
          return Response.json({ error }, { status: 404 })
        }

        const executor = ctx.executorManager.getExecutor({
          sessionId,
          cwd: body.cwd,
          sessionMetadata: {
            extensionId: conn.stableKey,
            browser: conn.info.browser || null,
            profile: conn.info ? { email: conn.info.email || '', id: conn.info.id || '' } : null,
          },
        })
        const metadata = executor.getSessionMetadata()
        return Response.json({
          id: sessionId,
          extensionId: metadata.extensionId,
          browser: metadata.browser,
          profile: metadata.profile,
        })
      },
    },

    '/api/session/delete': {
      POST: async (request) => {
        try {
          const body = await readJson<{ sessionId: string | number }>(request, { sessionId: '' })
          const sessionId = ctx.normalizeSessionId(body.sessionId)

          if (!sessionId) {
            return Response.json({ error: 'sessionId is required' }, { status: 400 })
          }

          if (!ctx.executorManager.deleteExecutor(sessionId)) {
            return Response.json({ error: `Session ${sessionId} not found` }, { status: 404 })
          }
          return Response.json({ success: true })
        } catch (error: any) {
          ctx.logger?.error('Delete session endpoint error:', error)
          return Response.json({ error: error.message }, { status: 500 })
        }
      },
    },

    // Registered after the static /api/session/* paths for readability only —
    // Bun matches a static route ahead of a parameterized one either way.
    '/api/session/:id': (request) => {
      const sessionId = request.params.id
      const executor = ctx.executorManager.getSession(sessionId)
      if (!executor) {
        return Response.json({ error: 'not found' }, { status: 404 })
      }
      const metadata = executor.getSessionMetadata()
      return Response.json({
        id: sessionId,
        extensionId: metadata.extensionId,
        browser: metadata.browser,
        profile: metadata.profile,
      })
    },
  }
}
