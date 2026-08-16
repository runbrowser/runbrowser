/**
 * CDP Discovery & Status endpoints.
 *
 * Standard Chrome DevTools Protocol HTTP API for tool discovery.
 * Spec: https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_http_handler.cc
 */

import type { BunRequest } from 'bun'
import type { Routes } from '../http.js'
import { readJson, text } from '../http.js'
import type { ServerContext } from '../server-context.js'
import { VERSION } from '../utils.js'

export function cdpDiscoveryRoutes(ctx: ServerContext): Routes {
  const getCdpWsUrl = (request: BunRequest) => {
    const hostHeader = request.headers.get('host') || `${ctx.host}:${ctx.port}`
    return `ws://${hostHeader}/cdp`
  }

  const versionHandler = (request: BunRequest) =>
    Response.json({
      Browser: `RunBrowser/${VERSION}`,
      'Protocol-Version': '1.3',
      webSocketDebuggerUrl: getCdpWsUrl(request),
    })

  const listHandler = (request: BunRequest) => {
    const wsUrl = getCdpWsUrl(request)
    const defaultTargets =
      ctx.getExtensionConnection(null, { allowFallback: true })?.connectedTargets || new Map()
    return Response.json(
      Array.from(defaultTargets.values()).map((target) => ({
        id: target.targetId,
        type: target.targetInfo.type,
        title: target.targetInfo.title,
        description: target.targetInfo.title,
        url: target.targetInfo.url,
        webSocketDebuggerUrl: wsUrl,
        devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`,
      })),
    )
  }

  const discovery = { GET: versionHandler, PUT: versionHandler }
  const list = { GET: listHandler, PUT: listHandler }

  return {
    // ---------- Health & version ----------

    '/': () => text('OK'),

    '/version': () => Response.json({ version: VERSION }),

    // ---------- Extension status ----------

    '/extension/status': () => {
      const defaultExtension = ctx.getExtensionConnection(null, { allowFallback: true })
      const connected = ctx.store.getState().extensions.size > 0
      const activeTargets = defaultExtension?.connectedTargets.size || 0
      const info = defaultExtension?.info

      return Response.json({
        connected,
        activeTargets,
        browser: info?.browser || null,
        profile: info ? { email: info.email || '', id: info.id || '' } : null,
        extensionVersion: info?.version || null,
      })
    },

    '/extensions/status': () => {
      const extensions = Array.from(ctx.store.getState().extensions.values()).map((ext) => ({
        extensionId: ext.id,
        stableKey: ext.stableKey,
        browser: ext.info.browser || null,
        profile: ext.info ? { email: ext.info.email || '', id: ext.info.id || '' } : null,
        activeTargets: ext.connectedTargets.size,
        extensionVersion: ext.info?.version || null,
      }))
      return Response.json({ extensions })
    },

    // Session lookup — sessionId for every connected target.
    '/json/sessions': () => {
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
      return Response.json(sessions)
    },

    // ---------- CDP discovery ----------

    '/json/version': discovery,
    '/json/version/': discovery,
    '/json/list': list,
    '/json/list/': list,
    '/json': list,
    '/json/': list,

    // ---------- MCP log relay ----------

    '/mcp-log': {
      POST: async (request) => {
        const body = await readJson<{ level?: string; args?: unknown[] } | null>(request, null)
        if (!body?.level) return Response.json({ ok: false }, { status: 400 })

        const logFn =
          ((ctx.logger as Record<string, unknown> | undefined)?.[body.level] as
            | ((...args: unknown[]) => void)
            | undefined) || ctx.logger?.log
        logFn?.(`[MCP] [${body.level.toUpperCase()}]`, ...(body.args ?? []))
        return Response.json({ ok: true })
      },
    },
  }
}
