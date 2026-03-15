/**
 * Management commands: session, config, serve, logfile, skill
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'

import { registerBuiltinCommand, type SessionResolver } from './index.js'
import type { ParsedArgs } from '../args.js'
import { output, ok } from '../output.js'
import {
  VERSION,
  RELAY_PORT,
  LOG_FILE_PATH,
  LOG_CDP_FILE_PATH,
  CONFIG_FILE_PATH,
  isPortInUse,
  killPortProcess,
  readConfig,
  writeConfig,
  RelayApiClient,
} from '@jiweiyuan/runbrowser-server'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ============================================================================
// session
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'session',
    description: 'Manage sessions: new, list, delete',
    positionals: [
      { name: 'command', description: 'new, list, delete', required: true },
      { name: 'id', description: 'Session ID (for delete)' },
    ],
    flags: {
      browser: { type: 'string', description: 'Browser stable key (for new)' },
    },
  },
  async execute(args, resolveSession) {
    const cmd = args.subcommand
    if (!cmd) throw new Error('Usage: runbrowser session <new|list|delete> [id]')

    const config = readConfig()
    const client = new RelayApiClient({
      host: (args.host || process.env.RUNBROWSER_HOST || config.host) as string | undefined,
      token: (args.token || process.env.RUNBROWSER_TOKEN || config.token) as string | undefined,
      logger: console,
    })
    const cliRelayEnv = { RUNBROWSER_AUTO_ENABLE: '1' }

    switch (cmd) {
      case 'new': {
        await client.ensureServer(cliRelayEnv)
        let extensions = await client.waitForExtensions({ timeoutMs: 12000, pollIntervalMs: 250 })
        if (extensions.length === 0) {
          console.error(pc.dim('Waiting for extension...'))
          extensions = await client.waitForExtensions({ timeoutMs: 10000, pollIntervalMs: 250 })
        }
        if (extensions.length === 0) throw new Error('No connected browsers. Click the RunBrowser extension icon.')

        let ext = extensions[0]
        const browserKey = args.flags.get('browser') as string | undefined

        if (extensions.length > 1) {
          if (!browserKey) {
            console.log('Multiple browsers detected:\n')
            console.log('KEY                      BROWSER  PROFILE')
            console.log('-----------------------  -------  -------')
            for (const e of extensions) {
              console.log(`${(e.stableKey || '-').padEnd(23)}  ${(e.browser || 'Chrome').padEnd(7)}  ${e.profile?.email || '(not signed in)'}`)
            }
            console.log('\nRun again with --browser <key>.')
            process.exit(1)
          }
          ext = extensions.find((e) => e.stableKey === browserKey)!
          if (!ext) throw new Error(`Browser not found: ${browserKey}`)
        }

        const extensionId = ext.extensionId === 'default' ? null : ext.stableKey || ext.extensionId
        const session = await client.createSession({ extensionId, cwd: process.cwd() })
        if (args.json) output({ id: session.id }, true)
        else console.log(`Session ${session.id} created.`)
        break
      }

      case 'list': {
        await client.ensureServer(cliRelayEnv)
          const sessions = await client.listSessions()
          if (args.json) { console.log(JSON.stringify(sessions)); return }
          if (sessions.length === 0) { console.log('No active sessions'); return }
          const idW = Math.max(2, ...sessions.map((s) => String(s.id).length))
          const brW = Math.max(7, ...sessions.map((s) => (s.browser || 'Chrome').length))
          const prW = Math.max(7, ...sessions.map((s) => (s.profile?.email || '').length || 1))
          console.log('ID'.padEnd(idW) + '  ' + 'BROWSER'.padEnd(brW) + '  ' + 'PROFILE'.padEnd(prW) + '  STATE KEYS')
          console.log('-'.repeat(idW + brW + prW + 20))
          for (const s of sessions) {
            console.log(String(s.id).padEnd(idW) + '  ' + (s.browser || 'Chrome').padEnd(brW) + '  ' + (s.profile?.email || '-').padEnd(prW) + '  ' + (s.stateKeys.length > 0 ? s.stateKeys.join(', ') : '-'))
          }
        break
      }

      case 'delete': {
        const id = args.positionals[0]
        if (!id) throw new Error('Session ID required: session delete <id>')
        await client.ensureServer(cliRelayEnv)
    await client.deleteSession(id); console.log(`Session ${id} deleted.`)
        break
      }

      default:
        throw new Error(`Unknown session command: ${cmd}. Use: new, list, delete`)
    }
  },
})

// ============================================================================
// config
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'config',
    description: 'Manage config: set, unset, show',
    positionals: [
      { name: 'command', description: 'set, unset, show', required: true },
      { name: 'key', description: 'Config key (dot notation)' },
      { name: 'value', description: 'Config value' },
    ],
  },
  async execute(args) {
    const cmd = args.subcommand
    const key = args.positionals[0]
    const value = args.positionals[1]

    switch (cmd) {
      case 'set': {
        if (!key || !value) throw new Error('Usage: config set <key> <value>')
        const config = readConfig()
        setNestedValue(config, key, value)
        writeConfig(config)
        console.log(`${key} = ${key.includes('token') ? '***' : value}`)
        break
      }
      case 'unset': {
        if (!key) throw new Error('Usage: config unset <key>')
        const config = readConfig()
        deleteNestedValue(config, key)
        writeConfig(config)
        console.log(`Removed ${key}`)
        break
      }
      case 'show': {
        const config = readConfig()
        console.log(`Config: ${CONFIG_FILE_PATH}`)
        if (Object.keys(config).length === 0) { console.log('(empty)'); return }
        if (config.host) console.log(`  host:    ${config.host}`)
        if (config.token) console.log(`  token:   ${'*'.repeat(config.token.length)}`)
        if (config.profile) console.log(`  profile: ${config.profile}`)
        break
      }
      default:
        throw new Error(`Unknown config command: ${cmd ?? 'none'}. Use: set, unset, show`)
    }
  },
})

// ============================================================================
// serve
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'serve',
    description: 'Start the relay server (run on same host as Chrome)',
    flags: {
      host:    { type: 'string',  description: 'Bind host (0.0.0.0 for remote)', default: '127.0.0.1' },
      replace: { type: 'boolean', description: 'Kill existing server' },
    },
  },
  async execute(args) {
    const host = (args.flags.get('host') as string) ?? '127.0.0.1'
    const token = args.token || process.env.RUNBROWSER_TOKEN
    if ((host === '0.0.0.0' || host === '::') && !token) {
      throw new Error('Auth token required for public host. Use --token or RUNBROWSER_TOKEN.')
    }
    const portInUse = await isPortInUse(RELAY_PORT)
    if (portInUse) {
      if (!args.flags.get('replace')) { console.log(`Server already running on port ${RELAY_PORT}. Use --replace to restart.`); process.exit(0) }
      console.log(`Killing existing server on port ${RELAY_PORT}...`)
      await killPortProcess({ port: RELAY_PORT })
    }
    const { createFileLogger, startRunBrowserCDPRelayServer } = await import('@jiweiyuan/runbrowser-server')
    const logger = createFileLogger()
    process.title = 'runbrowser-serve'
    process.on('uncaughtException', async (err) => { await logger.error('Uncaught:', err); process.exit(1) })
    process.on('unhandledRejection', async (reason) => { await logger.error('Unhandled:', reason); process.exit(1) })
    const server = await startRunBrowserCDPRelayServer({ port: RELAY_PORT, host, token, logger })
    console.log(`RunBrowser relay server started on ${host}:${RELAY_PORT}`)
    console.log(`Logs: ${logger.logFilePath}`)
    const shutdown = () => { console.log('\nShutting down...'); server.close(); process.exit(0) }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  },
})

// ============================================================================
// logfile
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'logfile',
    description: 'Print log file paths',
  },
  async execute() {
    console.log(`relay: ${LOG_FILE_PATH}`)
    console.log(`cdp:   ${LOG_CDP_FILE_PATH}`)
  },
})

// ============================================================================
// skill
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'skill',
    description: 'Print full usage instructions',
  },
  async execute() {
    const p = path.join(__dirname, '..', 'src', 'skill.md')
    if (fs.existsSync(p)) {
      console.log(fs.readFileSync(p, 'utf-8'))
    } else {
      // Fallback for built dist
      const distP = path.join(__dirname, '..', '..', 'src', 'skill.md')
      if (fs.existsSync(distP)) console.log(fs.readFileSync(distP, 'utf-8'))
      else console.log('skill.md not found')
    }
  },
})

// ============================================================================
// Helpers
// ============================================================================

function setNestedValue(obj: any, key: string, value: string) {
  const parts = key.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {}
    }
    current = current[parts[i]]
  }
  const last = parts[parts.length - 1]
  if (value === 'true') current[last] = true
  else if (value === 'false') current[last] = false
  else if (/^\d+$/.test(value)) current[last] = parseInt(value, 10)
  else current[last] = value
}

function deleteNestedValue(obj: any, key: string) {
  const parts = key.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) return
    current = current[parts[i]]
  }
  delete current[parts[parts.length - 1]]
}
