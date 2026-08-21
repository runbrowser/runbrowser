/**
 * Management commands: session, config, serve, logfile, skill
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
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
  RUNBROWSER_DIR,
  readConfig,
  writeConfig,
  RelayApiClient,
} from '../../server/index.js'

import skillMarkdown from '../skill.md' with { type: 'text' }
import agentSkillMarkdown from '../agent-skill.md' with { type: 'text' }

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
        if (extensions.length === 0) throw new Error('No connected browsers. Click the runbrowser extension icon.')

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
    const { createFileLogger, startRunBrowserCDPRelayServer } = await import('../../server/index.js')
    const logger = createFileLogger()
    process.title = 'runbrowser-serve'
    process.on('uncaughtException', async (err) => { await logger.error('Uncaught:', err); process.exit(1) })
    process.on('unhandledRejection', async (reason) => { await logger.error('Unhandled:', reason); process.exit(1) })
    const server = await startRunBrowserCDPRelayServer({ port: RELAY_PORT, host, token, logger })
    console.log(`runbrowser relay server started on ${host}:${RELAY_PORT}`)
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

/**
 * Locate a markdown file on disk.
 *
 * Only `skill path` needs a real path, and only a source checkout has one — a
 * compiled binary carries the content but no filesystem. Everything that wants
 * the text uses the embedded import instead.
 */
function packageFile(name: string): string | null {
  const candidate = path.join(__dirname, '..', name)
  return fs.existsSync(candidate) ? candidate : null
}

/**
 * Where we remember what we installed and exactly what we wrote.
 *
 * A marker line inside the file proves *origin* but not *absence of edits*: a
 * file we wrote and the user then edited still carries the marker, so marker
 * checking alone will happily overwrite their work on the next install and
 * delete it on uninstall. Recording a content hash is what makes "ours and
 * untouched" a question we can actually answer.
 */
const INSTALL_STATE_PATH = path.join(RUNBROWSER_DIR, 'skill-install.json')

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex')
}

function readInstallState(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(INSTALL_STATE_PATH, 'utf-8')) as Record<string, string>
  } catch {
    return {}
  }
}

function writeInstallState(state: Record<string, string>) {
  fs.mkdirSync(path.dirname(INSTALL_STATE_PATH), { recursive: true })
  fs.writeFileSync(INSTALL_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8')
}

/**
 * Ours and unmodified since we wrote it — the only state in which replacing or
 * removing a file is safe.
 */
function isOursAndUnmodified(target: string, state: Record<string, string>): boolean {
  const recorded = state[target]
  if (!recorded) return false
  try {
    return sha256(fs.readFileSync(target, 'utf-8')) === recorded
  } catch {
    return false
  }
}

/**
 * Agents that read `<home>/skills/<name>/SKILL.md`.
 *
 * The list is deliberately a list. Every entry here is an agent observed to
 * use this exact layout — frontmatter with `name` and `description`, one
 * directory per skill. Writing a SKILL.md into an agent that reads something
 * else is worse than writing nothing: it reports success, costs a file, and
 * changes no behaviour, so the tool looks installed while the agent has never
 * heard of it. An agent belongs here once its layout is confirmed, not
 * because it is popular.
 *
 * `.agents` is the cross-agent convention rather than one product.
 */
const SKILL_HOMES = ['.claude', '.agents', '.codex', '.cursor', '.gemini', '.openclaw']

/**
 * Skill directories to write, for the agents actually installed.
 *
 * Presence of the agent's home directory is the detection: it means the agent
 * has run on this machine. Creating `~/.codex` for someone who does not use
 * Codex would be litter, and litter that looks like configuration.
 *
 * Defaults to the current project rather than $HOME: a skill installed next to
 * the code it is used on can be committed, reviewed and versioned with that
 * repo, and installing it never silently changes how agents behave in every
 * other checkout on the machine. `--global` opts into that.
 *
 * In a project the fallback is the two conventional directories, because
 * running this here is an explicit act of setting up this repo. Globally
 * there is no fallback — an installer calls this unattended, and inventing an
 * agent home on a machine with no agent on it is not its business.
 */
function skillTargets(global: boolean): string[] {
  const base = global ? os.homedir() : process.cwd()
  const detected = SKILL_HOMES.filter((home) => fs.existsSync(path.join(base, home)))
  const homes = detected.length > 0 ? detected : global ? [] : ['.claude', '.agents']
  return homes.map((home) => path.join(base, home, 'skills', 'runbrowser'))
}

/**
 * Where the skill landed before the CLI was renamed to runbrowser.
 *
 * Changing only the new path would leave every existing install with a stale
 * copy under a name no later version touches — and agents pick a skill by that
 * name, so the old one keeps winning. Removal goes through the same ownership
 * check as everything else: `browser` is generic enough that another tool may
 * legitimately own it, and a skill we did not write is never ours to delete.
 */
function legacySkillTargets(global: boolean): string[] {
  const base = global ? os.homedir() : process.cwd()
  return SKILL_HOMES.map((home) => path.join(base, home, 'skills', 'browser'))
}

function removeLegacySkill(global: boolean, state: Record<string, string>): string[] {
  const removed: string[] = []
  for (const dir of legacySkillTargets(global)) {
    const target = path.join(dir, 'SKILL.md')
    if (!fs.existsSync(target)) continue
    if (!isOursAndUnmodified(target, state)) continue
    fs.rmSync(target)
    delete state[target]
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
    removed.push(target)
  }
  return removed
}

registerBuiltinCommand({
  def: {
    name: 'skill',
    description: 'Print the agent reference, or install it into your agent skill directories',
    positionals: [
      { name: 'action', description: 'install, uninstall, path — omit to print the reference' },
    ],
    flags: {
      global: { type: 'boolean', alias: 'g', description: 'Install into $HOME instead of the current project' },
    },
  },
  async execute(args) {
    const action = args.subcommand
    const global = Boolean(args.flags.get('global'))

    if (!action) {
      console.log(skillMarkdown)
      return
    }

    if (action === 'path') {
      const reference = packageFile('skill.md')
      if (!reference) {
        throw new Error(
          'This build embeds the reference rather than shipping a file. Run `runbrowser skill > SKILL.md` to write it out.',
        )
      }
      console.log(reference)
      return
    }

    if (action === 'install') {
      const body = agentSkillMarkdown
      const hash = sha256(body)
      const state = readInstallState()

      const targets = skillTargets(global)
      if (targets.length === 0) {
        console.log(
          'No agent found on this machine, so there is nowhere to install to.\n' +
            `Looked for: ${SKILL_HOMES.map((h) => `~/${h}`).join(', ')}`,
        )
        return
      }

      const installed: string[] = []
      for (const dir of targets) {
        const target = path.join(dir, 'SKILL.md')
        if (fs.existsSync(target)) {
          if (!isOursAndUnmodified(target, state)) {
            const why = state[target] ? 'you have edited it' : 'we did not write it'
            console.error(pc.yellow(`skipped ${target} — ${why}. Remove it to reinstall.`))
            continue
          }
          if (state[target] === hash) {
            console.log(pc.dim(`unchanged ${target}`))
            continue
          }
        }
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(target, body, 'utf-8')
        state[target] = hash
        installed.push(target)
      }

      const superseded = removeLegacySkill(global, state)
      writeInstallState(state)
      for (const p of installed) console.log(pc.green(`✓ ${p}`))
      for (const p of superseded) console.log(pc.dim(`removed ${p} (renamed to runbrowser)`))
      if (installed.length === 0 && superseded.length === 0) console.log('Already up to date.')
      return
    }

    if (action === 'uninstall') {
      const state = readInstallState()
      let removed = 0
      for (const dir of skillTargets(global)) {
        const target = path.join(dir, 'SKILL.md')
        if (!fs.existsSync(target)) continue
        if (!isOursAndUnmodified(target, state)) {
          const why = state[target] ? 'you have edited it' : 'we did not write it'
          console.error(pc.yellow(`skipped ${target} — ${why}.`))
          continue
        }
        fs.rmSync(target)
        delete state[target]
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
        console.log(pc.green(`✓ removed ${target}`))
        removed++
      }
      for (const p of removeLegacySkill(global, state)) {
        console.log(pc.green(`✓ removed ${p}`))
        removed++
      }
      writeInstallState(state)
      if (removed === 0) console.log('Nothing installed.')
      return
    }

    throw new Error(`Unknown skill command: ${action}. Use: install, uninstall, path`)
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
