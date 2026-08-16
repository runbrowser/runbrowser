/**
 * HTTP plumbing for Bun.serve.
 *
 * Bun's router owns path matching and params, so what used to be a middleware
 * chain is now two explicit wrappers: the CORS policy every response carries,
 * and the guard in front of privileged routes. Route modules export a plain
 * table of handlers and stay ignorant of both.
 */

import type { BunRequest, Server } from 'bun'
import pc from 'picocolors'
import type { Logger } from './server-context.js'
import type { SocketData } from './state.js'
import { EXTENSION_IDS } from './utils.js'

/**
 * A route handler returns undefined only when it has upgraded the request to a
 * WebSocket — Bun takes over the socket and there is no response to send.
 */
export type RouteHandler = (
  request: BunRequest,
  server: Server<SocketData>,
) => Response | undefined | Promise<Response | undefined>

export type RouteEntry =
  | RouteHandler
  | Partial<Record<'GET' | 'POST' | 'PUT' | 'HEAD' | 'OPTIONS', RouteHandler>>

export type Routes = Record<string, RouteEntry>

export function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * Only our own extension builds may read a response from the relay. An unknown
 * origin gets no Access-Control-Allow-Origin header at all, so a page on the
 * open web cannot read what it manages to send.
 */
function allowedOrigin(origin: string | null): string | null {
  if (!origin || !origin.startsWith('chrome-extension://')) return null
  const extensionId = origin.slice('chrome-extension://'.length)
  return EXTENSION_IDS.includes(extensionId) ? origin : null
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, HEAD, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    vary: 'Origin',
  }
}

function preflight(): RouteHandler {
  return (request) =>
    new Response(null, {
      status: 204,
      headers: corsHeaders(allowedOrigin(request.headers.get('origin'))),
    })
}

function withCors(handler: RouteHandler): RouteHandler {
  return async (request, server) => {
    // A route declared as a bare handler receives every method, so the
    // preflight is answered here rather than dispatched into it.
    if (request.method === 'OPTIONS') return preflight()(request, server)

    const response = await handler(request, server)
    // An upgraded WebSocket returns undefined — there is nothing to decorate.
    if (!response) return response
    for (const [key, value] of Object.entries(
      corsHeaders(allowedOrigin(request.headers.get('origin'))),
    )) {
      response.headers.set(key, value)
    }
    return response
  }
}

/**
 * Apply the CORS policy across a route table.
 *
 * Bun dispatches only the methods a route declares, so a route registered as
 * POST-only never sees the preflight. The OPTIONS handler has to be added here
 * rather than wrapped around an existing one.
 */
export function withCorsRoutes(routes: Routes): Routes {
  const wrapped: Routes = {}

  for (const [path, entry] of Object.entries(routes)) {
    if (typeof entry === 'function') {
      wrapped[path] = withCors(entry)
      continue
    }

    const byMethod: Record<string, RouteHandler> = {}
    for (const [method, handler] of Object.entries(entry)) {
      if (handler) byMethod[method] = withCors(handler)
    }
    byMethod.OPTIONS ??= preflight()
    wrapped[path] = byMethod as RouteEntry
  }

  return wrapped
}

/**
 * Guard for /api/* and /recording/*.
 *
 * CORS alone does not prevent cross-origin POST. Browsers skip the preflight
 * for "simple" requests (POST + Content-Type: text/plain), so a malicious page
 * can fire-and-forget a POST at localhost and the code runs before CORS enters
 * the picture. Three layers:
 *
 * 1. Sec-Fetch-Site is a forbidden header browsers set on every request. If it
 *    is present and not same-origin/none, a browser sent it cross-origin.
 *    Non-browser clients never send it, so they are unaffected.
 * 2. POST must be application/json, which forces a preflight as a fallback —
 *    and the CORS policy above already fails that preflight.
 * 3. In token mode (remote access), the token is required.
 */
export function createPrivilegedGuard(options: { token?: string; logger?: Logger }) {
  const { token, logger } = options

  return (handler: RouteHandler): RouteHandler =>
    async (request, server) => {
      const url = new URL(request.url)

      const secFetchSite = request.headers.get('sec-fetch-site')
      if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
        logger?.log(
          pc.red(
            `Rejecting ${url.pathname}: cross-origin browser request (Sec-Fetch-Site: ${secFetchSite})`,
          ),
        )
        return text('Forbidden - Cross-origin requests not allowed', 403)
      }

      if (request.method === 'POST') {
        const contentType = request.headers.get('content-type') || ''
        if (!contentType.includes('application/json')) {
          logger?.log(
            pc.red(
              `Rejecting ${url.pathname}: Content-Type must be application/json, got: ${contentType}`,
            ),
          )
          return text('Content-Type must be application/json', 415)
        }
      }

      if (token) {
        const authHeader = request.headers.get('authorization') || ''
        const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
        const queryToken = url.searchParams.get('token')
        if (bearerToken !== token && queryToken !== token) {
          logger?.log(pc.red(`Rejecting ${url.pathname}: invalid or missing token`))
          return text('Unauthorized', 401)
        }
      }

      return handler(request, server)
    }
}

/** Apply a wrapper to every handler in a route table. */
export function wrapRoutes(routes: Routes, wrap: (handler: RouteHandler) => RouteHandler): Routes {
  const wrapped: Routes = {}

  for (const [path, entry] of Object.entries(routes)) {
    if (typeof entry === 'function') {
      wrapped[path] = wrap(entry)
      continue
    }
    const byMethod: Record<string, RouteHandler> = {}
    for (const [method, handler] of Object.entries(entry)) {
      if (handler) byMethod[method] = wrap(handler)
    }
    wrapped[path] = byMethod as RouteEntry
  }

  return wrapped
}

/**
 * Read a JSON body, tolerating an empty one.
 *
 * Hono's c.req.json() threw on an empty body and two callers depended on the
 * fallback, so the tolerance is preserved rather than pushed onto each route.
 */
export async function readJson<T>(request: Request, fallback: T): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    return fallback
  }
}
