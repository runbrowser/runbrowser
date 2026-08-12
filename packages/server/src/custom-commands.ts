/**
 * Custom command loader.
 *
 * Loads user-defined commands from ~/.runbrowser/commands/<site>/<name>.ts
 * Uses jiti to support TypeScript files directly — no build step needed.
 *
 * Example: ~/.runbrowser/commands/reddit/hot.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { createJiti } from 'jiti'
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

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
})

/**
 * List all available custom commands by scanning ~/.runbrowser/commands/.
 */
export function listCustomCommands(): CommandDef[] {
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
        const mod = jiti(path.join(siteDir, file)) as CommandModule
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
export function loadCommand(site: string, name: string): CommandModule | null {
  const candidates = [
    path.join(COMMANDS_DIR, site, `${name}.ts`),
    path.join(COMMANDS_DIR, site, `${name}.js`),
    path.join(COMMANDS_DIR, site, `${name}.mjs`),
  ]

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const mod = jiti(filePath) as CommandModule
      if (typeof mod.run !== 'function') {
        throw new Error(`Command ${site}/${name} must export a run() function`)
      }
      return mod
    }
  }

  return null
}
