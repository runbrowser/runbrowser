/**
 * Commands subgroup: list, install, uninstall community commands.
 *
 * Usage:
 *   termio-browser commands list              — lists available packages
 *   termio-browser commands install reddit    — downloads reddit/*.ts → ~/.termio/browser/commands/reddit/
 *   termio-browser commands uninstall reddit  — removes ~/.termio/browser/commands/reddit/
 */

import fs from 'node:fs'
import path from 'node:path'
import pc from 'picocolors'
import { TERMIO_BROWSER_DIR } from '../../server/index.js'
import { registerBuiltinCommand, type SessionResolver } from './index.js'
import type { ParsedArgs } from '../args.js'

const COMMANDS_DIR = path.join(TERMIO_BROWSER_DIR, 'commands')

/**
 * Where plugins come from by default: this project's own `plugins/` directory.
 *
 * Any GitHub repository laid out the same way works — `--repo owner/name`, or
 * TERMIO_BROWSER_PLUGIN_REPO. Installing is only a download, so a plugin from
 * someone else's repo is the same thing as one written by hand into
 * ~/.termio/browser/commands/.
 */
const DEFAULT_REPO = 'termio-sh/browser'
const DEFAULT_PATH = 'plugins'

type PluginSource = { repo: string; path: string }

function resolveSource(args: ParsedArgs): PluginSource {
  const repo = (args.flags.get('repo') as string) || process.env.TERMIO_BROWSER_PLUGIN_REPO || DEFAULT_REPO
  // `--path ""` is meaningful: repositories that keep adapters at their root,
  // like bb-sites, need it. Testing truthiness would silently ignore it.
  const dir = args.flags.has('path')
    ? String(args.flags.get('path') ?? '')
    : (process.env.TERMIO_BROWSER_PLUGIN_PATH ?? DEFAULT_PATH)

  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error(`Not a repository: ${repo}. Expected owner/name.`)
  }
  return { repo, path: dir.replace(/^\/+|\/+$/g, '') }
}

function contentsUrl({ repo, path: dir }: PluginSource, subpath = ''): string {
  const base = `https://api.github.com/repos/${repo}/contents`
  const parts = [dir, subpath].filter(Boolean).join('/')
  return parts ? `${base}/${parts}` : base
}

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
async function listAvailable(source: PluginSource): Promise<string[]> {
  const entries: GitHubFile[] = await fetchGitHub(contentsUrl(source))
  return entries
    .filter(e => e.type === 'dir')
    .map(e => e.name)
    .sort()
}

/**
 * Install a package: download all .ts files from repo/<site>/ to ~/.termio/browser/commands/<site>/
 */
async function installPackage(site: string, source: PluginSource): Promise<string[]> {
  const files: GitHubFile[] = await fetchGitHub(contentsUrl(source, site))
  const tsFiles = files.filter(f => f.name.endsWith('.ts') || f.name.endsWith('.js'))

  if (tsFiles.length === 0) {
    throw new Error(`No command files found for "${site}"`)
  }

  // Download everything before writing anything. A failure partway through
  // used to leave an empty or half-filled directory that later read as
  // "installed" — the reason `commands install` could report success and
  // produce nothing.
  const downloaded: Array<{ name: string; content: string }> = []
  for (const file of tsFiles) {
    const resp = await fetch(file.download_url)
    if (!resp.ok) {
      const hint = resp.status === 429 ? ' (rate limited by GitHub — try again shortly)' : ''
      throw new Error(`Failed to download ${file.name}: ${resp.status}${hint}`)
    }
    downloaded.push({ name: file.name, content: await resp.text() })
  }

  const destDir = path.join(COMMANDS_DIR, site)
  fs.mkdirSync(destDir, { recursive: true })
  for (const file of downloaded) {
    fs.writeFileSync(path.join(destDir, file.name), file.content, 'utf-8')
  }

  return downloaded.map((f) => f.name)
}

/**
 * Uninstall a package: remove ~/.termio/browser/commands/<site>/
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
    flags: {
      repo: { type: 'string', description: `Source repository, owner/name (default: ${DEFAULT_REPO})` },
      path: { type: 'string', description: `Directory within that repo (default: ${DEFAULT_PATH})` },
    },
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
          const source = resolveSource(args)
          const available = await listAvailable(source)
          // Anything already on disk is listed too, whether or not this source
          // knows about it — a hand-written command is as real as a fetched one.
          const local = fs.existsSync(COMMANDS_DIR)
            ? fs.readdirSync(COMMANDS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
            : []

          console.log(pc.bold(`Command extensions in ${source.repo}${source.path ? '/' + source.path : ''}:`))
          console.log()
          for (const p of available) {
            const marker = local.includes(p) ? pc.green(' ✓ installed') : ''
            console.log(`  ${pc.cyan(p)}${marker}`)
          }

          const localOnly = local.filter((p) => !available.includes(p)).sort()
          if (localOnly.length > 0) {
            console.log()
            console.log(pc.bold('Installed, not from this source:'))
            console.log()
            for (const p of localOnly) console.log(`  ${pc.cyan(p)}${pc.green(' ✓ installed')}`)
          }

          console.log()
          console.log(`Run ${pc.cyan('termio-browser commands install <package>')} to install.`)
          console.log(pc.dim(`Another repository: --repo owner/name [--path <dir>]`))
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
          const source = resolveSource(args)
          console.log(`Installing ${pc.cyan(pkg)} from ${source.repo}...`)
          const files = await installPackage(pkg, source)
          console.log(pc.green(`✓ Installed ${pkg}/`))
          for (const f of files) {
            // Printed from the directory actually written to. The literal that
            // used to be here named a path the CLI stopped using.
            console.log(pc.dim(`  → ${path.join(COMMANDS_DIR, pkg, f)}`))
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
