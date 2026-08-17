/**
 * Plugin subgroup: list, install, uninstall site plugins.
 *
 * A plugin is a site folder you install; a command is one thing inside it you
 * invoke. `runbrowser plugin install reddit` fetches the folder, and
 * `runbrowser reddit posts` runs a command from it — which is why the loader
 * next door still speaks of commands and this file does not.
 *
 * Usage:
 *   runbrowser plugin list                — plugins available and installed
 *   runbrowser plugin install reddit      — reddit/*.ts → ~/.runbrowser/plugins/reddit/
 *   runbrowser plugin uninstall reddit    — removes ~/.runbrowser/plugins/reddit/
 */

import fs from 'node:fs'
import path from 'node:path'
import pc from 'picocolors'
import { RUNBROWSER_DIR } from '../../server/index.js'
import { registerBuiltinCommand, type SessionResolver } from './index.js'
import type { ParsedArgs } from '../args.js'

const PLUGINS_DIR = path.join(RUNBROWSER_DIR, 'plugins')

/**
 * Where plugins come from by default: this project's own `plugins/` directory.
 *
 * Any GitHub repository laid out the same way works — `--repo owner/name`, or
 * RUNBROWSER_PLUGIN_REPO. Installing is only a download, so a plugin from
 * someone else's repo is the same thing as one written by hand into
 * ~/.runbrowser/plugins/.
 */
const DEFAULT_REPO = 'termio-sh/runbrowser'
const DEFAULT_PATH = 'plugins'

type PluginSource = { repo: string; path: string }

function resolveSource(args: ParsedArgs): PluginSource {
  const repo = (args.flags.get('repo') as string) || process.env.RUNBROWSER_PLUGIN_REPO || DEFAULT_REPO
  // `--path ""` is meaningful: repositories that keep adapters at their root,
  // like bb-sites, need it. Testing truthiness would silently ignore it.
  const dir = args.flags.has('path')
    ? String(args.flags.get('path') ?? '')
    : (process.env.RUNBROWSER_PLUGIN_PATH ?? DEFAULT_PATH)

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
async function listAvailable(source: PluginSource): Promise<string[]> {
  const entries: GitHubFile[] = await fetchGitHub(contentsUrl(source))
  return entries
    .filter(e => e.type === 'dir')
    .map(e => e.name)
    .sort()
}

/**
 * Install a package: download all .ts files from repo/<site>/ to ~/.runbrowser/plugins/<site>/
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

  const destDir = path.join(PLUGINS_DIR, site)
  fs.mkdirSync(destDir, { recursive: true })
  for (const file of downloaded) {
    fs.writeFileSync(path.join(destDir, file.name), file.content, 'utf-8')
  }

  return downloaded.map((f) => f.name)
}

/**
 * Uninstall a package: remove ~/.runbrowser/plugins/<site>/
 */
function uninstallPackage(site: string): boolean {
  const dir = path.join(PLUGINS_DIR, site)
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
    name: 'plugin',
    aliases: ['plugins'],
    description: 'Manage site plugins: list, install, uninstall',
    positionals: [
      { name: 'action', description: 'Action: list, install, uninstall', required: true },
      { name: 'package', description: 'Plugin name (e.g. reddit, v2ex)' },
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
      console.log(`  runbrowser plugin list                  List available plugins`)
      console.log(`  runbrowser plugin install <package>     Install a plugin`)
      console.log(`  runbrowser plugin uninstall <package>   Uninstall a plugin`)
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
          const local = fs.existsSync(PLUGINS_DIR)
            ? fs.readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
            : []

          console.log(pc.bold(`Plugins in ${source.repo}${source.path ? '/' + source.path : ''}:`))
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
          console.log(`Run ${pc.cyan('runbrowser plugin install <package>')} to install.`)
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
          console.error('Usage: runbrowser plugin install <package>')
          console.error(`Run ${pc.cyan('runbrowser plugin list')} to see available packages.`)
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
            console.log(pc.dim(`  → ${path.join(PLUGINS_DIR, pkg, f)}`))
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
          console.error('Usage: runbrowser plugin uninstall <package>')
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
