/**
 * Built-in command definitions.
 *
 * Each command is a CommandDef with metadata for --help generation
 * and a handler function for execution.
 */

import type { CommandDef, ParsedArgs } from '../args.js'
import type { RelayApiClient } from '@termio/browser-server'

// ============================================================================
// Types
// ============================================================================

export interface CommandHandler {
  def: CommandDef
  execute: (args: ParsedArgs, resolveSession: SessionResolver) => Promise<void>
}

export type SessionResolver = (args: ParsedArgs) => Promise<{ sessionId: string; client: RelayApiClient }>

// ============================================================================
// Command registry
// ============================================================================

const commands = new Map<string, CommandHandler>()

export function registerBuiltinCommand(handler: CommandHandler) {
  commands.set(handler.def.name, handler)
  if (handler.def.aliases) {
    for (const alias of handler.def.aliases) {
      commands.set(alias, handler)
    }
  }
}

export function getBuiltinCommand(name: string): CommandHandler | undefined {
  return commands.get(name)
}

export function getAllBuiltinCommands(): CommandDef[] {
  // Deduplicate aliases
  const seen = new Set<string>()
  const result: CommandDef[] = []
  for (const handler of commands.values()) {
    if (!seen.has(handler.def.name)) {
      seen.add(handler.def.name)
      result.push(handler.def)
    }
  }
  return result
}
