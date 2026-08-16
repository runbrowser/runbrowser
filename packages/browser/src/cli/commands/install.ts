/**
 * Commands subgroup: list, install, uninstall community commands.
 *
 * Usage:
 *   termio-browser commands list              — lists available packages
 *   termio-browser commands install reddit    — downloads reddit/*.ts → ~/.runbrowser/commands/reddit/
 *   termio-browser commands uninstall reddit  — removes ~/.runbrowser/commands/reddit/
 */

import fs from 'node:fs'
import path from 'node:path'
import pc from 'picocolors'
import { TERMIO_BROWSER_DIR } from '../../server/index.js'
import { registerBuiltinCommand, type SessionResolver } from './index.js'
import type { ParsedArgs } from '../args.js'

const COMMANDS_DIR = path.join(TERMIO_BROWSER_DIR, 'commands')
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
      'User-Agent': 'termio-browser-cli',
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
// Register: commands (subgroup with list, install, uninstall)
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'commands',
    description: 'Manage command extensions: list, install, uninstall',
    positionals: [
      { name: 'action', description: 'Action: list, install, uninstall', required: true },
      { name: 'package', description: 'Package name (e.g. reddit, youtube)' },
    ],
  },
  async execute(args: ParsedArgs, _resolveSession: SessionResolver) {
    // args.subcommand = action (list, install, uninstall)
    // args.positionals[0] = package name (for install/uninstall)
    const action = args.subcommand
    const pkg = args.positionals[0]

    if (!action || args.help) {
      console.log(pc.bold('Usage:'))
      console.log(`  termio-browser commands list                  List available command extensions`)
      console.log(`  termio-browser commands install <package>     Install a command extension`)
      console.log(`  termio-browser commands uninstall <package>   Uninstall a command extension`)
      process.exit(0)
    }

    switch (action) {
      case 'list':
      case 'ls': {
        try {
          console.log(pc.bold('Available command extensions:'))
          console.log()
          const packages = await listAvailable()
          for (const p of packages) {
            const installed = fs.existsSync(path.join(COMMANDS_DIR, p))
            const marker = installed ? pc.green(' ✓ installed') : ''
            console.log(`  ${pc.cyan(p)}${marker}`)
          }
          console.log()
          console.log(`Run ${pc.cyan('termio-browser commands install <package>')} to install.`)
        } catch (e: any) {
          console.error(`Error: ${e.message}`)
          process.exit(1)
        }
        break
      }

      case 'install':
      case 'add': {
        if (!pkg) {
          console.error('Usage: termio-browser commands install <package>')
          console.error(`Run ${pc.cyan('termio-browser commands list')} to see available packages.`)
          process.exit(1)
        }

        try {
          console.log(`Installing ${pc.cyan(pkg)}...`)
          const files = await installPackage(pkg)
          console.log(pc.green(`✓ Installed ${pkg}/`))
          for (const f of files) {
            console.log(pc.dim(`  → ~/.runbrowser/commands/${pkg}/${f}`))
          }
        } catch (e: any) {
          console.error(`Error: ${e.message}`)
          process.exit(1)
        }
        break
      }

      case 'uninstall':
      case 'remove':
      case 'rm': {
        if (!pkg) {
          console.error('Usage: termio-browser commands uninstall <package>')
          process.exit(1)
        }

        if (uninstallPackage(pkg)) {
          console.log(pc.green(`✓ Uninstalled ${pkg}/`))
        } else {
          console.error(`Package "${pkg}" is not installed.`)
          process.exit(1)
        }
        break
      }

      default:
        console.error(`Unknown action: ${action}`)
        console.error(`Available actions: list, install, uninstall`)
        process.exit(1)
    }
  },
})
