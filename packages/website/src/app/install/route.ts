import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * `curl -fsSL https://runbrowser.com/install | sh`
 *
 * Read at build time, not per request: Vercel's runtime filesystem does not
 * carry files outside the app directory, so a dynamic handler would 404 in
 * production while working locally.
 */
export const dynamic = 'force-static'

// Vercel may build from the repo root or from this package, so cwd is not
// something to assume. Trying both and throwing beats shipping a broken
// install URL, which is exactly how this route 404'd before.
function readInstallScript(): string {
  const candidates = [
    join(process.cwd(), '../../scripts/install.sh'),
    join(process.cwd(), 'scripts/install.sh'),
  ]
  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(
    `install.sh not found. Looked in:\n  ${candidates.join('\n  ')}\ncwd: ${process.cwd()}`,
  )
}

export function GET(): Response {
  return new Response(readInstallScript(), {
    headers: {
      // text/plain, not x-shellscript: some proxies treat the latter as a
      // download and curl gets a content-disposition it did not ask for.
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
  })
}
