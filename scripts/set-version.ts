#!/usr/bin/env bun
/**
 * Write a release version into the package manifest.
 *
 * The version lives in two places that must agree: the package's own `version`
 * and the exact pins in `optionalDependencies`, one per platform binary. Bump
 * one without the other and npm reports nothing — the optional dependency is
 * simply absent, and the CLI fails on a user's first command. So nobody edits
 * either by hand; this writes both from one argument.
 *
 * Usage:
 *   bun scripts/set-version.ts 0.2.0
 */

import path from 'node:path'

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

const platforms = Object.keys(manifest.optionalDependencies ?? {})
if (platforms.length === 0) {
  console.error('No optionalDependencies to update — refusing to write a half-set version.')
  process.exit(1)
}

manifest.version = version
manifest.optionalDependencies = Object.fromEntries(platforms.map((name) => [name, version]))

await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

console.log(`@termio/browser -> ${version}`)
for (const name of platforms) console.log(`  ${name} -> ${version}`)
