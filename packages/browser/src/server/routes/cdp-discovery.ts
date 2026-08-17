/**
 * CDP Discovery & Status endpoints.
 *
 * Standard Chrome DevTools Protocol HTTP API for tool discovery.
 * Spec: https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_http_handler.cc
 */

import type { Hono } from 'hono'
import type { ServerContext } from '../server-context.js'
import { VERSION } from '../utils.js'

export function registerCdpDiscoveryRoutes(app: Hono, ctx: ServerContext) {
  const getCdpWsUrl = (c: { req: { header: (name: string) => string | undefined } }) => {
    const hostHeader = c.req.header('host') || `${ctx.host}:${ctx.port}`
    return `ws://${hostHeader}/cdp`
  }

  // ---------- Health & version ----------

  app.get('/', (c) => c.text('OK'))

  app.get('/version', (c) => c.json({ version: VERSION }))

  // ---------- Extension status ----------

  app.get('/extension/status', (c) => {
    const defaultExtension = ctx.getExtensionConnection(null, { allowFallback: true })
    const connected = ctx.store.getState().extensions.size > 0
    const activeTargets = defaultExtension?.connectedTargets.size || 0
    const info = defaultExtension?.info

    return c.json({
      connected,
      activeTargets,
      browser: info?.browser || null,
      profile: info ? { email: info.email || '', id: info.id || '' } : null,
      extensionVersion: info?.version || null,
    })
  })

  app.get('/extensions/status', (c) => {
    const extensions = Array.from(ctx.store.getState().extensions.values()).map((ext) => ({
      extensionId: ext.id,
      stableKey: ext.stableKey,
      browser: ext.info.browser || null,
      profile: ext.info ? { email: ext.info.email || '', id: ext.info.id || '' } : null,
      activeTargets: ext.connectedTargets.size,
      extensionVersion: ext.info?.version || null,
    }))
    return c.json({ extensions })
  })

  // Session lookup endpoint — returns sessionId for all connected targets
  app.get('/json/sessions', (c) => {
    const sessions: Array<{ sessionId: string; targetId: string; url: string; title: string }> = []
    for (const ext of ctx.store.getState().extensions.values()) {
      for (const target of ext.connectedTargets.values()) {
        sessions.push({
          sessionId: target.sessionId,
          targetId: target.targetId,
          url: target.targetInfo.url,
          title: target.targetInfo.title,
        })
      }
    }
    return c.json(sessions)
  })

  // ---------- CDP discovery (deduplicated) ----------

  const versionHandler = (c: any) => {
    return c.json({
      Browser: `RunBrowser/${VERSION}`,
      'Protocol-Version': '1.3',
      webSocketDebuggerUrl: getCdpWsUrl(c),
    })
  }

  const listHandler = (c: any) => {
    const wsUrl = getCdpWsUrl(c)
    const defaultTargets =
      ctx.getExtensionConnection(null, { allowFallback: true })?.connectedTargets || new Map()
    return c.json(
      Array.from(defaultTargets.values()).map((t) => ({
        id: t.targetId,
        type: t.targetInfo.type,
        title: t.targetInfo.title,
        description: t.targetInfo.title,
        url: t.targetInfo.url,
        webSocketDebuggerUrl: wsUrl,
        devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`,
      })),
    )
  }

  for (const path of ['/json/version', '/json/version/']) {
    app.on(['GET', 'PUT'], path, versionHandler)
  }

  for (const path of ['/json/list', '/json/list/', '/json', '/json/']) {
    app.on(['GET', 'PUT'], path, listHandler)
  }

  // ---------- MCP log relay ----------

  app.post('/mcp-log', async (c) => {
    try {
      const { level, args } = await c.req.json()
      const logFn = (ctx.logger as any)?.[level] || ctx.logger?.log
      const prefix = `[MCP] [${level.toUpperCase()}]`
      logFn?.(prefix, ...args)
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false }, 400)
    }
  })
}
