/**
 * Credential API endpoints.
 *
 * /api/login          — Secure login (agent never sees password)
 * /api/credentials    — List available credentials (metadata only)
 * /api/detect-forms   — Detect forms on current page
 * /api/credential-status — Check vault + policy status
 */

import type { Hono } from 'hono'
import type { ServerContext } from '../server-context.js'

export function registerApiCredentialRoutes(app: Hono, ctx: ServerContext) {
  app.post('/api/login', async (c) => {
    try {
      const body = (await c.req.json()) as {
        sessionId: string | number
        domain: string
        credentialHint?: string
        timeout?: number
      }
      const sessionId = ctx.normalizeSessionId(body.sessionId)
      if (!sessionId) return c.json({ error: 'sessionId is required' }, 400)
      if (!body.domain) return c.json({ error: 'domain is required' }, 400)

      if (!ctx.credentialBroker) {
        return c.json({
          status: 'not_configured',
          error: 'Credential broker is not configured. Set credentials.vault in ~/.runbrowser/config.json',
        })
      }

      const executor = ctx.getCDPExecutor(sessionId)
      if (!executor) return c.json({ error: `Session ${sessionId} not found` }, 404)

      const result = await ctx.credentialBroker.login(executor, {
        sessionId,
        domain: body.domain,
        credentialHint: body.credentialHint,
        timeout: body.timeout,
      })

      return c.json(result)
    } catch (error: any) {
      ctx.logger?.error('Login endpoint error:', error)
      return c.json({ status: 'failed', error: error.message }, 500)
    }
  })

  app.post('/api/credentials', async (c) => {
    try {
      const body = (await c.req.json()) as {
        sessionId: string | number
        domain: string
      }
      const sessionId = ctx.normalizeSessionId(body.sessionId)
      if (!sessionId) return c.json({ error: 'sessionId is required' }, 400)
      if (!body.domain) return c.json({ error: 'domain is required' }, 400)

      if (!ctx.credentialBroker) {
        return c.json({ credentials: [] })
      }

      const credentials = await ctx.credentialBroker.listCredentials(sessionId, body.domain)
      return c.json({ credentials })
    } catch (error: any) {
      return c.json({ error: error.message }, 500)
    }
  })

  app.post('/api/detect-forms', async (c) => {
    try {
      const body = (await c.req.json()) as { sessionId: string | number }
      const sessionId = ctx.normalizeSessionId(body.sessionId)
      if (!sessionId) return c.json({ error: 'sessionId is required' }, 400)

      if (!ctx.credentialBroker) {
        return c.json({ error: 'Credential broker not configured' }, 400)
      }

      const executor = ctx.getCDPExecutor(sessionId)
      if (!executor) return c.json({ error: `Session ${sessionId} not found` }, 404)

      const result = await ctx.credentialBroker.detectPageForms(executor)
      return c.json(result)
    } catch (error: any) {
      return c.json({ error: error.message }, 500)
    }
  })

  app.get('/api/credential-status', async (c) => {
    if (!ctx.credentialBroker) {
      return c.json({
        configured: false,
        vault: null,
        vaultAvailable: false,
        policy: null,
      })
    }

    const vaultAvailable = await ctx.credentialBroker.isVaultAvailable()
    return c.json({
      configured: true,
      vault: ctx.credentialBroker.getVaultName(),
      vaultAvailable,
      policy: ctx.credentialBroker.getPolicy(),
    })
  })
}
