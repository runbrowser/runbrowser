/**
 * Install/uninstall community commands from runbrowser/commands repo.
 *
 * Usage:
 *   runbrowser install reddit          — downloads reddit/*.ts → ~/.runbrowser/commands/reddit/
 *   runbrowser install --list          — lists available packages
 *   runbrowser uninstall reddit        — removes ~/.runbrowser/commands/reddit/
 */

import fs from 'node:fs'
import path from 'node:path'
import pc from 'picocolors'
import { RUNBROWSER_DIR } from '@jiweiyuan/runbrowser-server'
import { registerBuiltinCommand, type SessionResolver } from './index.js'
import type { ParsedArgs } from '../args.js'

const COMMANDS_DIR = path.join(RUNBROWSER_DIR, 'commands')
const REPO_API_BASE = 'https://api.github.com/repos/runbrowser/commands/contents'

interface GitHubFile {
  name: string
  path: string
  download_url: string
  type: 'file' | 'dir'
}

/**
 * Fetch JSON from GitHub API.
 */
async function fetchGitHub(url: string): Promise<any> {
  const resp = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'runbrowser-cli',
    },
  })
  if (!resp.ok) {
    throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`)
  }
  return resp.json()
}

/**
 * List available packages (directories in the repo root).
 */
async function listAvailable(): Promise<string[]> {
  const entries: GitHubFile[] = await fetchGitHub(REPO_API_BASE)
  return entries
    .filter(e => e.type === 'dir')
    .map(e => e.name)
    .sort()
}

/**
 * Install a package: download all .ts files from repo/<site>/ to ~/.runbrowser/commands/<site>/
 */
async function installPackage(site: string): Promise<string[]> {
  const files: GitHubFile[] = await fetchGitHub(`${REPO_API_BASE}/${site}`)
  const tsFiles = files.filter(f => f.name.endsWith('.ts') || f.name.endsWith('.js'))

  if (tsFiles.length === 0) {
    throw new Error(`No command files found for "${site}"`)
  }

  const destDir = path.join(COMMANDS_DIR, site)
  fs.mkdirSync(destDir, { recursive: true })

  const installed: string[] = []
  for (const file of tsFiles) {
    const resp = await fetch(file.download_url)
    if (!resp.ok) {
      throw new Error(`Failed to download ${file.name}: ${resp.status}`)
    }
    const content = await resp.text()
    const destPath = path.join(destDir, file.name)
    fs.writeFileSync(destPath, content, 'utf-8')
    installed.push(file.name)
  }

  return installed
}

/**
 * Uninstall a package: remove ~/.runbrowser/commands/<site>/
 */
function uninstallPackage(site: string): boolean {
  const dir = path.join(COMMANDS_DIR, site)
  if (!fs.existsSync(dir)) {
    return false
  }
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}

// ============================================================================
// Register: install
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'install',
    description: 'Install community commands from runbrowser/commands',
    positionals: [
      { name: 'site', description: 'Package to install (e.g. reddit, x, youtube)' },
    ],
    flags: {
      list: { type: 'boolean', alias: 'l', description: 'List available packages' },
    },
  },
  async execute(args: ParsedArgs, _resolveSession: SessionResolver) {
    const isList = args.flags.get('list') || args.unknownFlags.get('list')
    const site = args.subcommand

    if (isList || (!site && !args.help)) {
      // List available packages
      try {
        console.log(pc.bold('Available command packages:'))
        console.log()
        const packages = await listAvailable()
        for (const pkg of packages) {
          // Check if already installed
          const installed = fs.existsSync(path.join(COMMANDS_DIR, pkg))
          const marker = installed ? pc.green(' ✓ installed') : ''
          console.log(`  ${pc.cyan(pkg)}${marker}`)
        }
        console.log()
        console.log(`Run ${pc.cyan('runbrowser install <package>')} to install.`)
      } catch (e: any) {
        console.error(`Error: ${e.message}`)
        process.exit(1)
      }
      return
    }

    if (!site) {
      console.error('Usage: runbrowser install <package>')
      console.error(`Run ${pc.cyan('runbrowser install --list')} to see available packages.`)
      process.exit(1)
    }

    // Install the package
    try {
      console.log(`Installing ${pc.cyan(site)}...`)
      const files = await installPackage(site)
      console.log(pc.green(`✓ Installed ${site}/`))
      for (const f of files) {
        console.log(pc.dim(`  → ~/.runbrowser/commands/${site}/${f}`))
      }
    } catch (e: any) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
  },
})

// ============================================================================
// Register: uninstall
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'uninstall',
    description: 'Remove installed community commands',
    positionals: [
      { name: 'site', description: 'Package to uninstall', required: true },
    ],
  },
  async execute(args: ParsedArgs, _resolveSession: SessionResolver) {
    const site = args.subcommand
    if (!site) {
      console.error('Usage: runbrowser uninstall <package>')
      process.exit(1)
    }

    if (uninstallPackage(site)) {
      console.log(pc.green(`✓ Uninstalled ${site}/`))
    } else {
      console.error(`Package "${site}" is not installed.`)
      process.exit(1)
    }
  },
})
