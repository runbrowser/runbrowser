#!/usr/bin/env node

/**
 * RunBrowser CLI — hand-written argument parser with two-phase parsing.
 *
 * Phase 1: Parse known flags, stash unknown flags
 * Phase 2: After extensions/site commands load, re-resolve unknown flags
 *
 * Supports:
 * - Built-in commands: navigate, click, snapshot, session, ...
 * - Site commands: runbrowser github trending, runbrowser bilibili hot
 * - Extension-registered flags
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
} from '@jiweiyuan/runbrowser-server'

import { parseArgs, resolveUnknownFlags, type ParsedArgs, type FlagDef } from './args.js'
import { printMainHelp, printCommandHelp } from './help.js'
import { die } from './output.js'

// Import command registrations (side-effect: registers commands)
import './commands/navigation.js'
import './commands/observation.js'
import './commands/interaction.js'
import './commands/execution.js'
import './commands/management.js'

import { getBuiltinCommand, getAllBuiltinCommands, type SessionResolver } from './commands/index.js'

// ============================================================================
// Session resolver (shared across commands)
// ============================================================================

const cliRelayEnv = { RUNBROWSER_AUTO_ENABLE: '1' }

function createClient(args: ParsedArgs): RelayApiClient {
  const config = readConfig()
  return new RelayApiClient({
    host: args.host || process.env.RUNBROWSER_HOST || config.host,
    token: args.token || process.env.RUNBROWSER_TOKEN || config.token,
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
  if (process.env.RUNBROWSER_SESSION) {
    return { sessionId: process.env.RUNBROWSER_SESSION, client }
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
    console.error('No connected browsers. Click the RunBrowser extension icon.')
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

    // TODO: Phase 2 — resolve extension flags here
    // const extFlags = await loadExtensionFlags()
    // const unknown = resolveUnknownFlags(finalArgs, extFlags)
    // if (unknown.length > 0) die(`Unknown flags: ${unknown.join(', ')}`)

    await builtin.execute(finalArgs, resolveSession)
    return
  }

  // ── Try site command: `runbrowser <site> <name>` ──
  // TODO: Load site commands from ~/.runbrowser/commands/ and relay server
  // For now, show error
  if (args.subcommand) {
    const key = `${args.command}/${args.subcommand}`

    // Check if --help
    if (args.help) {
      // TODO: Look up site command def and show help
      die(`Unknown command: ${args.command} ${args.subcommand}`)
    }

    // TODO: Execute site command
    die(`Unknown command: ${args.command} ${args.subcommand}\nSite commands not yet implemented. Run 'runbrowser --help' for available commands.`)
  }

  // ── Unknown command ──
  console.error(`Unknown command: ${args.command}`)
  console.error(`Run ${pc.cyan('runbrowser --help')} to see available commands.`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
