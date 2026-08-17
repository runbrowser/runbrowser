/**
 * CLI argument parser — hand-written for two-phase parsing.
 *
 * Phase 1: Parse with built-in flags only (extensions not loaded yet)
 * Phase 2: Re-parse with extension-registered flags
 *
 * Supports:
 * - Subcommands: `runbrowser navigate <url>`, `runbrowser github trending`
 * - Global flags: --session, --host, --token, --json, --help, --version
 * - Command-specific flags: --limit, --format, --interactive, etc.
 * - Extension flags: dynamically registered, unknown on first pass
 */

// ============================================================================
// Types
// ============================================================================

export type FlagType = 'string' | 'boolean' | 'number'

export interface FlagDef {
  type: FlagType
  alias?: string
  default?: string | boolean | number
  description?: string
  required?: boolean
  choices?: string[]
}

export interface PositionalDef {
  name: string
  description?: string
  required?: boolean
  variadic?: boolean  // captures remaining positionals (e.g. files..)
}

export interface CommandDef {
  name: string
  aliases?: string[]
  description: string
  usage?: string
  positionals?: PositionalDef[]
  flags?: Record<string, FlagDef>
  /** If true, this command definition came from a user site command */
  isSiteCommand?: boolean
}

export interface ParsedArgs {
  command: string | null
  subcommand: string | null
  positionals: string[]

  // Global flags
  session?: string
  host?: string
  token?: string
  json?: boolean
  format?: string
  help?: boolean
  version?: boolean

  // Command-specific + extension flags
  flags: Map<string, string | boolean | number>

  // Unknown flags (first pass)
  unknownFlags: Map<string, string | boolean>
}

// ============================================================================
// Global flags — always available on every command
// ============================================================================

export const GLOBAL_FLAGS: Record<string, FlagDef> = {
  session:  { type: 'string',  alias: 's', description: 'Session ID (auto-created if omitted)' },
  host:     { type: 'string',  description: 'Relay server host (or RUNBROWSER_HOST)' },
  token:    { type: 'string',  description: 'Auth token (or RUNBROWSER_TOKEN)' },
  json:     { type: 'boolean', description: 'JSON output' },
  format:   { type: 'string',  alias: 'f', description: 'Output format', choices: ['table', 'json', 'csv', 'md', 'yaml'] },
  help:     { type: 'boolean', alias: 'h', description: 'Show help' },
  version:  { type: 'boolean', alias: 'v', description: 'Show version' },
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse CLI arguments.
 *
 * @param argv - process.argv.slice(2)
 * @param commandFlags - flags for the resolved command (filled on second pass)
 * @param extensionFlags - dynamically registered extension flags
 */
export function parseArgs(
  argv: string[],
  commandFlags?: Record<string, FlagDef>,
  extensionFlags?: Map<string, FlagDef>,
): ParsedArgs {
  const result: ParsedArgs = {
    command: null,
    subcommand: null,
    positionals: [],
    flags: new Map(),
    unknownFlags: new Map(),
  }

  // Build alias → name map
  const aliasMap = new Map<string, string>()
  for (const [name, def] of Object.entries(GLOBAL_FLAGS)) {
    if (def.alias) aliasMap.set(def.alias, name)
  }
  if (commandFlags) {
    for (const [name, def] of Object.entries(commandFlags)) {
      if (def.alias) aliasMap.set(def.alias, name)
    }
  }
  if (extensionFlags) {
    for (const [name, def] of extensionFlags) {
      if (def.alias) aliasMap.set(def.alias, name)
    }
  }

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]

    // ── Long flags: --name or --name value ──
    if (arg.startsWith('--')) {
      const name = arg.slice(2)

      // Handle --no-xxx for boolean flags
      if (name.startsWith('no-')) {
        const positiveName = name.slice(3)
        const resolved = resolveFlag(positiveName, commandFlags, extensionFlags)
        if (resolved && resolved.def.type === 'boolean') {
          setFlagValue(result, resolved, positiveName, false)
          i++
          continue
        }
      }

      const resolved = resolveFlag(name, commandFlags, extensionFlags)
      if (resolved) {
        if (resolved.def.type === 'boolean') {
          setFlagValue(result, resolved, name, true)
        } else {
          i++
          if (i >= argv.length) break
          setFlagValue(result, resolved, name, coerceValue(argv[i], resolved.def.type))
        }
      } else {
        // Unknown flag → stash for second pass
        if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          result.unknownFlags.set(name, argv[++i])
        } else {
          result.unknownFlags.set(name, true)
        }
      }

    // ── Short flags: -s, -f ──
    } else if (arg.startsWith('-') && arg.length === 2 && arg !== '--') {
      const ch = arg[1]
      const fullName = aliasMap.get(ch)
      if (fullName) {
        const resolved = resolveFlag(fullName, commandFlags, extensionFlags)
        if (resolved) {
          if (resolved.def.type === 'boolean') {
            setFlagValue(result, resolved, fullName, true)
          } else {
            i++
            if (i >= argv.length) break
            setFlagValue(result, resolved, fullName, coerceValue(argv[i], resolved.def.type))
          }
        }
      }

    // ── Positional arguments → command / subcommand / rest ──
    } else if (arg !== '--') {
      if (!result.command) {
        result.command = arg
      } else if (!result.subcommand) {
        result.subcommand = arg
      } else {
        result.positionals.push(arg)
      }
    }

    i++
  }

  return result
}

// ============================================================================
// Internal helpers
// ============================================================================

interface ResolvedFlag {
  target: 'global' | 'command' | 'extension'
  def: FlagDef
}

function resolveFlag(
  name: string,
  commandFlags?: Record<string, FlagDef>,
  extensionFlags?: Map<string, FlagDef>,
): ResolvedFlag | null {
  if (name in GLOBAL_FLAGS) {
    return { target: 'global', def: GLOBAL_FLAGS[name] }
  }
  if (commandFlags && name in commandFlags) {
    return { target: 'command', def: commandFlags[name] }
  }
  if (extensionFlags?.has(name)) {
    return { target: 'extension', def: extensionFlags.get(name)! }
  }
  return null
}

function setFlagValue(result: ParsedArgs, resolved: ResolvedFlag, name: string, value: string | boolean | number) {
  if (resolved.target === 'global') {
    (result as any)[name] = value
  } else {
    result.flags.set(name, value)
  }
}

function coerceValue(raw: string, type: FlagType): string | number | boolean {
  if (type === 'number') {
    const n = Number(raw)
    return isNaN(n) ? raw as any : n
  }
  if (type === 'boolean') {
    return raw === 'true' || raw === '1'
  }
  return raw
}

/**
 * Re-parse unknown flags after extensions have loaded.
 * Returns any flags that are still unrecognized.
 */
export function resolveUnknownFlags(
  args: ParsedArgs,
  extensionFlags: Map<string, FlagDef>,
): string[] {
  const stillUnknown: string[] = []

  for (const [name, value] of args.unknownFlags) {
    if (extensionFlags.has(name)) {
      const def = extensionFlags.get(name)!
      args.flags.set(name, def.type === 'boolean' ? (value === true || value === 'true') : coerceValue(String(value), def.type))
    } else {
      stillUnknown.push(`--${name}`)
    }
  }

  return stillUnknown
}

/**
 * Get the effective value of a flag, considering defaults.
 */
export function getFlagValue(
  args: ParsedArgs,
  name: string,
  commandDef?: CommandDef,
): string | boolean | number | undefined {
  // Check if set explicitly
  if (args.flags.has(name)) return args.flags.get(name)

  // Check global flags
  if (name in args && (args as any)[name] !== undefined) return (args as any)[name]

  // Fall back to default
  const flagDef = commandDef?.flags?.[name]
  if (flagDef?.default !== undefined) return flagDef.default

  return undefined
}
