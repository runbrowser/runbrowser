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
} from '@jiweiyuan/runbrowser-server'

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
    const host = (args.host || process.env.RUNBROWSER_HOST || config.host) as string | undefined
    const client = new RelayApiClient({
      host,
      token: (args.token || process.env.RUNBROWSER_TOKEN || config.token) as string | undefined,
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
      console.log(`extension:  ${pc.red('not connected')} — click the RunBrowser icon on a tab`)
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

    // A bare number switches to that tab: `runbrowser tab 2`.
    const index = Number(cmd)
    if (!Number.isNaN(index)) {
      await client.switchTab(sessionId, index)
      ok(`Switched to tab ${index}`, args.json)
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
        if (args.json) output({ index: result.index }, true)
        else console.log(`Opened tab ${result.index}${url ? ` at ${url}` : ''}`)
        break
      }
      case 'close': {
        const target = args.positionals[0] ? Number(args.positionals[0]) : undefined
        await client.closeTab(sessionId, target)
        ok(`Closed tab${target != null ? ` ${target}` : ''}`, args.json)
        break
      }
      default:
        throw new Error(`Unknown tab command: ${cmd}. Use: list, new, close, or <index>`)
    }
  },
})
