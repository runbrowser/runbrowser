#!/usr/bin/env bun
/**
 * Compile runbrowser for every supported platform and lay out one npm
 * package per platform.
 *
 * Bun cross-compiles all targets from a single machine, so this is one CI job
 * rather than a runner matrix. Each platform package carries nothing but its
 * binary and the os/cpu fields npm uses to pick exactly one; the launcher in
 * bin.js resolves whichever landed.
 *
 * Output: dist-npm/<package-name>/ ready to publish.
 */

import { mkdir, rm, writeFile, chmod } from 'node:fs/promises'
import path from 'node:path'
import packageJson from '../packages/browser/package.json' with { type: 'json' }

import { TARGETS, optionalDependenciesFor, packageNameFor } from './targets.ts'

const root = path.resolve(import.meta.dir, '..')
const entry = path.join(root, 'packages', 'browser', 'src', 'cli', 'cli.ts')
const outputRoot = path.join(root, 'dist-npm')

/**
 * The launcher finds a binary through optionalDependencies, so that field and
 * this target list have to agree, at the same version.
 *
 * An absent field means this is a plain build — CI compiles on every push to
 * check the artifact still runs, and has no release to prepare. A field that
 * is present and disagrees means set-version wrote one and something changed
 * underneath it, which npm would report as nothing at all: the optional
 * dependency is simply missing and the CLI fails on a user's first command.
 */
const declared = packageJson.optionalDependencies ?? {}

if (Object.keys(declared).length > 0) {
  const expected = optionalDependenciesFor(packageJson.version)
  if (JSON.stringify(expected) !== JSON.stringify(declared)) {
    console.error('optionalDependencies do not match the build targets.')
    console.error('Run `bun scripts/set-version.ts <version>` to rewrite them.\n')
    console.error('  declared:', JSON.stringify(declared))
    console.error('  expected:', JSON.stringify(expected))
    process.exit(1)
  }
}

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })

const built: string[] = []

for (const target of TARGETS) {
  // One source for the name, so the manifest's optionalDependencies and the
  // directory published under it cannot say different things.
  const name = packageNameFor(target)
  const directory = path.join(outputRoot, name)
  const exe = target.os === 'win32' ? 'runbrowser.exe' : 'runbrowser'
  const outfile = path.join(directory, exe)

  await mkdir(directory, { recursive: true })

  const compile = Bun.spawnSync([
    'bun',
    'build',
    '--compile',
    `--target=${target.bunTarget}`,
    `--outfile=${outfile}`,
    entry,
  ], { cwd: root, stdout: 'pipe', stderr: 'pipe' })

  if (compile.exitCode !== 0) {
    console.error(`FAILED ${target.bunTarget}`)
    console.error(new TextDecoder().decode(compile.stderr))
    process.exit(1)
  }

  await chmod(outfile, 0o755)

  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify(
      {
        name,
        version: packageJson.version,
        description: `runbrowser binary for ${target.os}-${target.cpu}`,
        license: packageJson.license,
        repository: packageJson.repository,
        homepage: packageJson.homepage,
        os: [target.os],
        cpu: [target.cpu],
        files: [exe],
        publishConfig: { access: 'public' },
      },
      null,
      2,
    ) + '\n',
  )

  const size = (await Bun.file(outfile).stat()).size
  console.log(`${name.padEnd(34)} ${(size / 1024 / 1024).toFixed(0)} MB`)
  built.push(name)
}

console.log(`\n${built.length} platform packages in dist-npm/`)
