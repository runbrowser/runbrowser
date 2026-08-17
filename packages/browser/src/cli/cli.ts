#!/usr/bin/env node

/**
 * runbrowser CLI — hand-written argument parser.
 *
 * Dispatches, in order:
 * - built-in commands: cdp, eval, tab, status, session, mcp, …
 * - site commands: `runbrowser github trending`, whose flags are not known
 *   until the relay reports them, so unrecognised flags are collected rather
 *   than rejected and handed to the command as its arguments.
 *
 * A parser library would want the command tree declared up front, which the
 * site commands are not. That is the whole reason this is hand-written; if
 * site commands ever move behind a static manifest, the reason goes with them.
 */

import util from 'node:util'
import pc from 'picocolors'

Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}

import {
  VERSION,
  RELAY_PORT,
  RelayApiClient,
  readConfig,
} from '../server/index.js'

import { parseArgs, type ParsedArgs, type FlagDef } from './args.js'
import { printMainHelp, printCommandHelp } from './help.js'



// Import command registrations (side-effect: registers commands)
import './commands/execution.js'
import './commands/browser.js'
import './commands/management.js'
import './commands/install.js'
import './commands/mcp.js'
import './commands/exec.js'

import { getBuiltinCommand, getAllBuiltinCommands, type SessionResolver } from './commands/index.js'

// ============================================================================
// Session resolver (shared across commands)
// ============================================================================

const cliRelayEnv = { TERMIO_BROWSER_AUTO_ENABLE: '1' }

function createClient(args: ParsedArgs): RelayApiClient {
  const config = readConfig()
  return new RelayApiClient({
    host: args.host || process.env.TERMIO_BROWSER_HOST || config.host,
    token: args.token || process.env.TERMIO_BROWSER_TOKEN || config.token,
    logger: console,
  })
}

const resolveSession: SessionResolver = async (args) => {
  const client = createClient(args)
  await client.ensureServer(cliRelayEnv)

  // Explicit session
  if (args.session != null) {
    return { sessionId: String(args.session), client }
  }
  // Env var
  if (process.env.TERMIO_BROWSER_SESSION) {
    return { sessionId: process.env.TERMIO_BROWSER_SESSION, client }
  }

  // Auto-session: try to reuse existing, or create new
  const sessions = await client.listSessions()
  if (sessions.length > 0) {
    return { sessionId: String(sessions[0].id), client }
  }

  // No sessions — create one
  let extensions = await client.waitForExtensions({ timeoutMs: 12000, pollIntervalMs: 250 })
  if (extensions.length === 0) {
    console.error(pc.dim('Waiting for extension to connect...'))
    extensions = await client.waitForExtensions({ timeoutMs: 10000, pollIntervalMs: 250 })
  }
  if (extensions.length === 0) {
    console.error('No connected browsers. Click the runbrowser extension icon.')
    process.exit(1)
  }
  const ext = extensions[0]
  const extensionId = ext.extensionId === 'default' ? null : ext.stableKey || ext.extensionId
  const session = await client.createSession({ extensionId, cwd: process.cwd() })
  console.error(pc.dim(`Auto-created session ${session.id}`))
  return { sessionId: String(session.id), client }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const argv = process.argv.slice(2)

  // ── Phase 1: Parse with built-in flags only ──
  const args = parseArgs(argv)

  // Version
  if (args.version && !args.command) {
    console.log(VERSION)
    process.exit(0)
  }

  // No command → show help
  if (!args.command) {
    if (args.help) {
      printMainHelp(VERSION, getAllBuiltinCommands(), [])
    } else {
      console.log(`runbrowser v${VERSION}`)
      console.log(`Run ${pc.cyan('runbrowser --help')} to see available commands.`)
    }
    process.exit(0)
  }

  // ── help [command] — the same output as --help, as a word ──
  // Agents reach for `<tool> help` before they reach for `<tool> --help`, and
  // failing that guess with "Unknown command" is a wasted turn.
  if (args.command === 'help') {
    const topic = args.subcommand
    if (topic) {
      const target = getBuiltinCommand(topic)
      if (!target) {
        console.error(`Unknown command: ${topic}`)
        process.exit(1)
      }
      printCommandHelp(target.def)
    } else {
      printMainHelp(VERSION, getAllBuiltinCommands(), [])
    }
    process.exit(0)
  }

  // ── Try built-in command ──
  const builtin = getBuiltinCommand(args.command)
  if (builtin) {
    // Show command-specific help
    if (args.help) {
      printCommandHelp(builtin.def)
      process.exit(0)
    }

    // Re-parse with command-specific flags for proper flag resolution
    const finalArgs = parseArgs(argv, builtin.def.flags)

    await builtin.execute(finalArgs, resolveSession)
    return
  }

  // ── Try custom command: `runbrowser <site> <name>` ──
  if (args.subcommand) {
    const site = args.command!
    const name = args.subcommand

    const { sessionId, client } = await resolveSession(args)

    try {
      // Custom command args are in unknownFlags (not registered as built-in flags)
      const commandArgs = {
        ...Object.fromEntries(args.flags),
        ...Object.fromEntries(args.unknownFlags),
      }
      const result = await client.runCommand(sessionId, site, name, commandArgs)

      if (args.json) {
        console.log(JSON.stringify(result.data))
      } else {
        const { formatTable } = await import('./output.js')
        const fmt = (args.format as string) || 'table'
        console.log(formatTable(result.data, result.columns, fmt))
      }
    } catch (e: any) {
      console.error(`Error: ${e.message}`)
      process.exit(1)
    }
    return
  }

  // ── Unknown command ──
  console.error(`Unknown command: ${args.command}`)
  console.error(`Run ${pc.cyan('runbrowser --help')} to see available commands.`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
