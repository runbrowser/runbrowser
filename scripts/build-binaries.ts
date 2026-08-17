#!/usr/bin/env bun
/**
 * Compile termio-browser for every supported platform and lay out one npm
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

const TARGETS = [
  { bunTarget: 'bun-darwin-arm64', os: 'darwin', cpu: 'arm64' },
  { bunTarget: 'bun-darwin-x64', os: 'darwin', cpu: 'x64' },
  { bunTarget: 'bun-linux-x64', os: 'linux', cpu: 'x64' },
  { bunTarget: 'bun-linux-arm64', os: 'linux', cpu: 'arm64' },
  { bunTarget: 'bun-windows-x64', os: 'win32', cpu: 'x64' },
] as const

const root = path.resolve(import.meta.dir, '..')
const entry = path.join(root, 'packages', 'browser', 'src', 'cli', 'cli.ts')
const outputRoot = path.join(root, 'dist-npm')

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })

const built: string[] = []

for (const target of TARGETS) {
  const name = `@termio/browser-${target.os === 'win32' ? 'win32' : target.os}-${target.cpu}`
  const directory = path.join(outputRoot, name.replace('@termio/', ''))
  const exe = target.os === 'win32' ? 'termio-browser.exe' : 'termio-browser'
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
        description: `termio-browser binary for ${target.os}-${target.cpu}`,
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
