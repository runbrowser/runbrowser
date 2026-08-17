/**
 * Custom command loader.
 *
 * Loads user-defined commands from ~/.termio/browser/commands/<site>/<name>.ts
 * TypeScript is imported directly — the runtime transpiles it, no build step
 * and no loader dependency.
 *
 * Example: ~/.termio/browser/commands/reddit/hot.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { TERMIO_BROWSER_DIR } from './utils.js'

const COMMANDS_DIR = path.join(TERMIO_BROWSER_DIR, 'commands')

export interface CommandArg {
  type: 'string' | 'number' | 'boolean'
  description?: string
  default?: string | number | boolean
}

export interface CommandDef {
  site: string
  name: string
  description: string
  args?: Record<string, CommandArg>
  columns?: string[]
}

export interface CommandModule {
  description: string
  args?: Record<string, CommandArg>
  columns?: string[]
  run: (ctx: CommandContext, args: Record<string, any>) => Promise<any[]>
}

export interface CommandContext {
  /** Navigate the browser to a URL */
  navigate: (url: string) => Promise<void>
  /** Evaluate JavaScript in the browser page and return the result */
  evaluate: (code: string) => Promise<any>
  /** Wait for milliseconds */
  wait: (ms: number) => Promise<void>
}

/**
 * Import a command module.
 *
 * The URL carries the file's mtime because ESM caches a specifier for the life
 * of the process. Without it, a command the user just edited keeps running its
 * previous version until the server restarts — which is the whole point of
 * keeping these as loose files.
 */
async function importCommand(filePath: string): Promise<CommandModule> {
  const { mtimeMs } = fs.statSync(filePath)
  const specifier = `${pathToFileURL(filePath).href}?v=${mtimeMs}`
  const namespace = (await import(specifier)) as CommandModule & { default?: CommandModule }

  // A command may export its members individually or as a default object.
  return typeof namespace.run === 'function' ? namespace : (namespace.default ?? namespace)
}

/**
 * List all available custom commands by scanning ~/.termio/browser/commands/.
 */
export async function listCustomCommands(): Promise<CommandDef[]> {
  const commands: CommandDef[] = []

  if (!fs.existsSync(COMMANDS_DIR)) {
    return commands
  }

  const sites = fs.readdirSync(COMMANDS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)

  for (const site of sites) {
    const siteDir = path.join(COMMANDS_DIR, site)
    const files = fs.readdirSync(siteDir)
      .filter(f => f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.mjs'))

    for (const file of files) {
      const name = path.basename(file, path.extname(file))
      try {
        const mod = await importCommand(path.join(siteDir, file))
        commands.push({
          site,
          name,
          description: mod.description || `${site} ${name}`,
          args: mod.args,
          columns: mod.columns,
        })
      } catch {
        commands.push({ site, name, description: `${site} ${name}` })
      }
    }
  }

  return commands
}

/**
 * Load a command module by site and name.
 */
export async function loadCommand(site: string, name: string): Promise<CommandModule | null> {
  const candidates = [
    path.join(COMMANDS_DIR, site, `${name}.ts`),
    path.join(COMMANDS_DIR, site, `${name}.js`),
    path.join(COMMANDS_DIR, site, `${name}.mjs`),
  ]

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const mod = await importCommand(filePath)
      if (typeof mod.run !== 'function') {
        throw new Error(`Command ${site}/${name} must export a run() function`)
      }
      return mod
    }
  }

  return null
}
