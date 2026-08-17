/**
 * Browser-state commands: status, tab
 *
 * These are the two things that are *not* about the page — they are about the
 * connection. Anything that acts on page content belongs in `cdp`.
 */

import pc from 'picocolors'

import { registerBuiltinCommand } from './index.js'
import { output, ok } from '../output.js'
import {
  RELAY_PORT,
  RelayApiClient,
  isPortInUse,
  readConfig,
} from '../../server/index.js'

// ============================================================================
// status
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'status',
    description: 'Report whether a browser is attached, and what is bound to it',
  },
  async execute(args) {
    const config = readConfig()
    const host = (args.host || process.env.TERMIO_BROWSER_HOST || config.host) as string | undefined
    const client = new RelayApiClient({
      host,
      token: (args.token || process.env.TERMIO_BROWSER_TOKEN || config.token) as string | undefined,
      logger: console,
    })

    // Deliberately does not start the server. `status` answers a question; it
    // does not change the thing it is reporting on.
    const serverUp = host ? await remoteReachable(client) : await isPortInUse(RELAY_PORT)
    if (!serverUp) {
      const state = { server: false, extensions: [], sessions: [] }
      if (args.json) { console.log(JSON.stringify(state)); process.exit(1) }
      console.log(`server:     ${pc.red('not running')} (start it with \`runbrowser serve\`)`)
      process.exit(1)
    }

    const extensions = await client.fetchExtensionsStatus().catch(() => [])
    const sessions = await client.listSessions().catch(() => [])

    if (args.json) {
      console.log(JSON.stringify({ server: true, extensions, sessions }))
      if (extensions.length === 0) process.exit(1)
      return
    }

    console.log(`server:     ${pc.green('running')} on port ${RELAY_PORT}`)
    if (extensions.length === 0) {
      console.log(`extension:  ${pc.red('not connected')} — click the runbrowser icon on a tab`)
    } else {
      for (const e of extensions) {
        const who = e.profile?.email || '(not signed in)'
        console.log(`extension:  ${pc.green('connected')}  ${e.browser || 'Chrome'}  ${who}  ${e.stableKey || e.extensionId}`)
      }
    }
    console.log(`sessions:   ${sessions.length === 0 ? 'none' : sessions.map((s) => s.id).join(', ')}`)
    if (extensions.length === 0) process.exit(1)
  },
})

async function remoteReachable(client: RelayApiClient): Promise<boolean> {
  try {
    await client.checkRemoteServer()
    return true
  } catch {
    return false
  }
}

// ============================================================================
// tab
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'tab',
    description: 'List, open, switch and close browser tabs',
    positionals: [
      { name: 'command', description: 'list (default), new, close, or a tab index' },
      { name: 'arg', description: 'URL for new, index for close' },
    ],
  },
  async execute(args, resolveSession) {
    const { sessionId, client } = await resolveSession(args)
    const cmd = args.subcommand || 'list'

    // A bare number switches to that tab: `runbrowser tab 2`. Indexes are a
    // convenience for humans only — they are resolved to a target id here,
    // because Target.getTargets guarantees no ordering and the number could
    // name a different tab by the time the server saw it.
    const asIndex = Number(cmd)
    if (!Number.isNaN(asIndex)) {
      await switchToIndex(client, sessionId, asIndex, args.json)
      return
    }

    switch (cmd) {
      case 'list': {
        const result = await client.listTabs(sessionId)
        if (args.json) { console.log(JSON.stringify(result)); return }
        for (const tab of result.tabs) {
          const marker = tab.active ? pc.green('→') : ' '
          console.log(`${marker} [${tab.index}] ${tab.title || '(untitled)'} — ${tab.url}`)
        }
        break
      }
      case 'new': {
        const url = args.positionals[0]
        const result = await client.newTab(sessionId, url)
        if (args.json) output({ targetId: result.targetId }, true)
        else console.log(`Opened and bound to a new tab${url ? ` at ${url}` : ''}`)
        break
      }
      case 'switch': {
        const target = args.positionals[0]
        if (!target) throw new Error('Usage: runbrowser tab switch <index|targetId>')
        const asNum = Number(target)
        if (!Number.isNaN(asNum)) await switchToIndex(client, sessionId, asNum, args.json)
        else {
          await client.switchTab(sessionId, target)
          ok(`Switched to ${target}`, args.json)
        }
        break
      }
      case 'close': {
        const target = args.positionals[0]
        let targetId: string | undefined
        if (target) {
          const asNum = Number(target)
          targetId = Number.isNaN(asNum) ? target : await resolveIndex(client, sessionId, asNum)
        }
        await client.closeTab(sessionId, targetId)
        ok('Closed tab', args.json)
        break
      }
      default:
        throw new Error(`Unknown tab command: ${cmd}. Use: list, new, close, or <index>`)
    }
  },
})

/** Resolve a human-facing tab index to the stable target id behind it. */
async function resolveIndex(
  client: RelayApiClient,
  sessionId: string,
  index: number,
): Promise<string> {
  const { tabs } = await client.listTabs(sessionId)
  const tab = tabs[index]
  if (!tab) throw new Error(`No tab at index ${index} (${tabs.length} open)`)
  return tab.targetId
}

async function switchToIndex(
  client: RelayApiClient,
  sessionId: string,
  index: number,
  json?: boolean,
): Promise<void> {
  const targetId = await resolveIndex(client, sessionId, index)
  await client.switchTab(sessionId, targetId)
  ok(`Switched to tab ${index}`, json)
}
