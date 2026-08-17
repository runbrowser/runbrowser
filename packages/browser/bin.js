#!/usr/bin/env node
/**
 * Launcher for runbrowser.
 *
 * Runs under Node because that is the one runtime `npm i -g` guarantees. It
 * does no work itself: it finds the compiled binary for this platform —
 * installed as an optional dependency, so npm fetches only the matching one —
 * and hands over. Users need nothing but npm.
 *
 * A source checkout has no platform package. There it falls back to running
 * the TypeScript entrypoint under bun, which is how the repo runs.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)

const exe = process.platform === 'win32' ? 'runbrowser.exe' : 'runbrowser'
const platformPackage = `runbrowser-${process.platform}-${process.arch}`

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) return result.error
  process.exit(result.status ?? 1)
}

let resolved = null
try {
  resolved = require.resolve(`${platformPackage}/${exe}`)
} catch {
  // Not installed — either an unsupported platform or a source checkout.
}

if (resolved) {
  const error = run(resolved, argv)
  console.error(`runbrowser: could not run ${resolved}: ${error.message}`)
  process.exit(1)
}

const sourceEntry = path.join(here, 'src', 'cli', 'cli.ts')
if (existsSync(sourceEntry)) {
  const error = run('bun', [sourceEntry, ...argv])
  console.error(
    error.code === 'ENOENT'
      ? 'runbrowser: running from source requires bun (https://bun.sh).'
      : `runbrowser: could not run bun: ${error.message}`,
  )
  process.exit(1)
}

console.error(
  `runbrowser: no prebuilt binary for ${process.platform}-${process.arch}.\n` +
    `Expected the optional dependency ${platformPackage}. If your platform is\n` +
    `supported, reinstalling usually fixes it: npm i -g runbrowser`,
)
process.exit(1)
