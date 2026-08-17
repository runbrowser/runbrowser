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
 * An adapter in the `@meta` format: a JSON header comment followed by a bare
 * async function, which is evaluated *in the page* rather than on the host.
 *
 * This is browser-use's bb-sites layout. Supporting it is what lets someone run
 * `commands install <site> --repo epiral/bb-sites` and get that community's
 * adapters from their repository, on their terms — rather than this project
 * copying a corpus it has no licence to.
 */
type MetaHeader = {
  name?: string
  description?: string
  /** The origin the function runs against. Its cookies are the whole point. */
  domain?: string
  /** Loose form: a description string per argument, or a partial object. */
  args?: Record<string, string | Partial<CommandArg>>
  /** Typed form, when the adapter declares one. Preferred. */
  params?: Record<string, Partial<CommandArg> & { required?: boolean }>
  columns?: string[]
}

/**
 * Normalise the two argument shapes an @meta header may carry.
 *
 * `params` is the typed one and wins where present; `args` is often just a
 * description string per name. Left unnormalised, a string lands where the
 * help renderer expects an object and every argument reads as untyped.
 */
function normaliseArgs(meta: MetaHeader): Record<string, CommandArg> | undefined {
  const source = meta.params ?? meta.args
  if (!source) return undefined

  const args: Record<string, CommandArg> = {}
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      args[name] = { type: 'string', description: value }
      continue
    }
    args[name] = {
      type: value.type ?? 'string',
      description: value.description,
      default: value.default,
    }
  }
  return args
}

const META_BLOCK = /^\s*\/\*\s*@meta\s*([\s\S]*?)\*\//

function parseMetaAdapter(source: string, site: string, name: string): CommandModule | null {
  const match = source.match(META_BLOCK)
  if (!match) return null

  let meta: MetaHeader
  try {
    meta = JSON.parse(match[1])
  } catch (error) {
    throw new Error(`${site}/${name}: @meta header is not valid JSON — ${(error as Error).message}`)
  }

  const body = source.slice(match[0].length).trim()
  if (!body) throw new Error(`${site}/${name}: @meta header with no function after it`)

  return {
    description: meta.description || `${site} ${name}`,
    args: normaliseArgs(meta),
    columns: meta.columns,
    async run(ctx, args) {
      // The function is shipped into the page whole and called there, so it
      // gets the site's cookies, its origin and its own JavaScript — and costs
      // one round trip rather than one per statement.
      if (meta.domain) await ctx.navigate(`https://${meta.domain}`)
      return await ctx.evaluate(`await (${body})(${JSON.stringify(args ?? {})})`)
    },
  }
}

/**
 * Load a command from disk, in either supported format.
 *
 * The URL carries the file's mtime because ESM caches a specifier for the life
 * of the process. Without it, a command the user just edited keeps running its
 * previous version until the server restarts — which is the whole point of
 * keeping these as loose files.
 */
async function importCommand(filePath: string): Promise<CommandModule> {
  const source = fs.readFileSync(filePath, 'utf-8')
  const site = path.basename(path.dirname(filePath))
  const name = path.basename(filePath, path.extname(filePath))

  const adapter = parseMetaAdapter(source, site, name)
  if (adapter) return adapter

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
      // A leading underscore marks a file that is not itself a command —
      // shared code a site's adapters keep beside them.
      .filter(f => !f.startsWith('_'))

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
