// Downloads Prism.js assets into dist/src/ for the welcome page.
// Chrome extension CSP blocks external scripts, so we bundle them locally.
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/'
// Same env var vite.config.mts reads for outDir. Hardcoding 'dist' meant this
// wrote next to a build that went somewhere else: e2e builds into dist-<port>,
// so the download failed with ENOENT unless a stale default dist/ happened to
// be lying around from an earlier build.
const DEST = path.join(process.env.TERMIO_BROWSER_EXTENSION_DIST || 'dist', 'src')

const files: [string, string][] = [
  ['prism.min.js', 'prism.min.js'],
  ['components/prism-bash.min.js', 'prism-bash.min.js'],
]

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download ${url}: ${res.statusCode}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        res.on('end', () => {
          fs.writeFileSync(dest, Buffer.concat(chunks))
          resolve()
        })
        res.on('error', reject)
      })
      .on('error', reject)
  })
}

async function main() {
  await Promise.all(
    files.map(([src, dest]) => {
      return download(BASE + src, path.join(DEST, dest))
    }),
  )
  console.log(`Downloaded ${files.length} Prism.js files to ${DEST}`)
}

main()
