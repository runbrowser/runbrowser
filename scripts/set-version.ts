#!/usr/bin/env bun
/**
 * Write a release version into the package manifest.
 *
 * Two things have to agree: the package's own `version` and the exact pins on
 * each platform binary. Bump one without the other and npm reports nothing —
 * the optional dependency is simply absent, and the CLI fails on a user's
 * first command. So nobody edits either by hand; this writes both.
 *
 * The optionalDependencies are added here rather than kept in the manifest
 * because they name packages that exist only after a release publishes them.
 * In the source tree they would make a clean `pnpm install --frozen-lockfile`
 * unsatisfiable, which is how CI failed the first time it ran.
 *
 * Usage:
 *   bun scripts/set-version.ts 0.2.0
 */

import path from 'node:path'
import { optionalDependenciesFor } from './targets.ts'

const version = process.argv[2]

if (!version) {
  console.error('Usage: bun scripts/set-version.ts <version>')
  process.exit(1)
}

// Reject anything that is not a plain release version. npm would accept far
// more, but a tag typo should fail here rather than claim a version number
// that can never be reused.
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Not a valid version: ${version}`)
  console.error('Expected MAJOR.MINOR.PATCH, optionally with a prerelease suffix.')
  process.exit(1)
}

const manifestPath = path.resolve(import.meta.dir, '..', 'packages', 'browser', 'package.json')
const manifest = await Bun.file(manifestPath).json()

manifest.version = version
manifest.optionalDependencies = optionalDependenciesFor(version)

await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

console.log(`runbrowser -> ${version}`)
for (const name of Object.keys(manifest.optionalDependencies)) {
  console.log(`  ${name} -> ${version}`)
}
