import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

export default createMiddleware(routing)

export const config = {
  /*
   * Match all paths EXCEPT:
   * - _next (Next.js internals)
   * - Static files with extensions (.ico, .png, .jpg, .svg, .css, .js, .json, .md, etc.)
   * - .well-known (skills endpoint)
   * - resources (public API docs)
   * - install (the curl installer — locale-redirecting it 404s the script)
   */
  matcher: ['/((?!_next|.*\\..*|.well-known|resources|install).*)'],
}
