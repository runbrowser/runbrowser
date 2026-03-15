/**
 * Security middleware for privileged HTTP routes (/api/*, /recording/*).
 *
 * CORS alone does NOT prevent cross-origin POST attacks. Browsers skip the
 * preflight for "simple" requests (POST + Content-Type: text/plain), so a
 * malicious website can fire-and-forget a POST to localhost:19988/api/execute
 * and the code executes before CORS even enters the picture.
 *
 * Two layers of defense:
 * 1. Sec-Fetch-Site: browsers set this forbidden header on every request.
 *    If present and not "same-origin"/"none", it's a cross-origin browser
 *    request → reject. Node.js clients don't send it → unaffected.
 * 2. Content-Type must be application/json on POST. This forces a CORS
 *    preflight as a fallback, which our CORS policy already blocks.
 * 3. When token mode is enabled (remote access), require the token.
 */

import pc from 'picocolors'
import type { Logger } from '../server-context.js'

export function createPrivilegedMiddleware(options: {
  token?: string
  logger?: Logger
}) {
  const { token, logger } = options

  return async (
    c: { req: { path: string; method: string; url: string; header: (name: string) => string | undefined } },
    next: () => Promise<void>,
  ) => {
    // Block cross-origin browser requests via Sec-Fetch-Site header.
    const secFetchSite = c.req.header('sec-fetch-site')
    if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
      logger?.log(pc.red(`Rejecting ${c.req.path}: cross-origin browser request (Sec-Fetch-Site: ${secFetchSite})`))
      return (c as any).text('Forbidden - Cross-origin requests not allowed', 403)
    }

    // Require application/json on POST to force CORS preflight as backup defense.
    if (c.req.method === 'POST') {
      const contentType = c.req.header('content-type') || ''
      if (!contentType.includes('application/json')) {
        logger?.log(pc.red(`Rejecting ${c.req.path}: Content-Type must be application/json, got: ${contentType}`))
        return (c as any).text('Content-Type must be application/json', 415)
      }
    }

    // When token mode is enabled (remote/serve mode), require authentication.
    if (token) {
      const authHeader = c.req.header('authorization') || ''
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
      const url = new URL(c.req.url, 'http://localhost')
      const queryToken = url.searchParams.get('token')
      if (bearerToken !== token && queryToken !== token) {
        logger?.log(pc.red(`Rejecting ${c.req.path}: invalid or missing token`))
        return (c as any).text('Unauthorized', 401)
      }
    }

    return next()
  }
}
