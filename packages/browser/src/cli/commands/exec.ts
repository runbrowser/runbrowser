/**
 * exec — run a snippet against the browser, with helpers already in scope.
 *
 *   runbrowser exec <<'JS'
 *     await cdp('Page.navigate', { url: 'https://example.com' })
 *     await waitFor(async () => (await evaluate('document.readyState')) === 'complete')
 *     return await evaluate('document.title')
 *   JS
 *
 * The alternative is a verb per action, and every verb is a guess about which
 * arguments matter — `cdp` already reaches the whole protocol. What a verb
 * list cannot give you is composition: a loop, a condition, a wait built from
 * the events that actually arrived. That is what this is for.
 *
 * The helpers below are deliberately thin. Anything thicker belongs in the
 * workspace file, where it can be edited by whoever hit the missing case.
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { registerBuiltinCommand, type SessionResolver } from './index.js'
import type { ParsedArgs } from '../args.js'
import { RUNBROWSER_DIR, type RelayApiClient } from '../../server/index.js'

/** Where an agent keeps helpers it wrote itself. */
const WORKSPACE_DIR = path.join(RUNBROWSER_DIR, 'workspace')
const WORKSPACE_HELPERS = path.join(WORKSPACE_DIR, 'helpers.ts')

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

/**
 * Load helpers the agent wrote, keyed on mtime.
 *
 * ESM caches a specifier for the life of the process, which does not matter
 * for a one-shot CLI — but it does the moment this is called twice, and a
 * helper you just edited silently running its old body is the worst kind of
 * confusing.
 */
async function loadWorkspaceHelpers(): Promise<Record<string, unknown>> {
  if (!fs.existsSync(WORKSPACE_HELPERS)) return {}
  const { mtimeMs } = fs.statSync(WORKSPACE_HELPERS)
  const namespace = (await import(
    `${pathToFileURL(WORKSPACE_HELPERS).href}?v=${mtimeMs}`
  )) as Record<string, unknown>
  const { default: _default, ...named } = namespace
  return named
}

function buildHelpers(client: RelayApiClient, sessionId: string) {
  const cdp = async (method: string, params?: unknown) =>
    (await client.cdp(sessionId, method, params)).result

  const evaluate = async (expression: string) => {
    const result = await client.evaluate(sessionId, expression)
    if (result.isError) throw new Error(result.text)
    try {
      return JSON.parse(result.text)
    } catch {
      return result.text
    }
  }

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  /**
   * Poll until a predicate holds. Polling is the honest primitive here: the
   * event buffer tells you what happened, and this turns that into a wait
   * without inventing a verb per condition.
   */
  const waitFor = async <T>(
    predicate: () => Promise<T> | T,
    { timeout = 10000, interval = 100, label = 'condition' } = {},
  ): Promise<T> => {
    const deadline = Date.now() + timeout
    let last: unknown
    while (Date.now() < deadline) {
      try {
        const value = await predicate()
        if (value) return value
        last = value
      } catch (error) {
        last = error
      }
      await wait(interval)
    }
    throw new Error(`Timed out after ${timeout}ms waiting for ${label} (last: ${String(last)})`)
  }

  return {
    cdp,
    evaluate,
    js: evaluate,
    wait,
    waitFor,
    sessionId,

    pageInfo: async () => {
      const { tabs } = await client.listTabs(sessionId)
      const active = tabs.find((tab) => tab.active) ?? tabs[0]
      return { active, tabs }
    },

    tabs: async () => (await client.listTabs(sessionId)).tabs,
    newTab: (url?: string) => client.newTab(sessionId, url),
    switchTab: (targetId: string) => client.switchTab(sessionId, targetId),
    closeTab: (targetId?: string) => client.closeTab(sessionId, targetId),

    drainEvents: (options: { peek?: boolean } = {}) => client.drainEvents(sessionId, options),
    setEventFilter: (pattern: string | null) => client.setEventFilter(sessionId, pattern),
  }
}

registerBuiltinCommand({
  def: {
    name: 'exec',
    description: 'Run a snippet against the browser with helpers in scope',
    usage: "runbrowser exec [code]   (reads stdin when no code is given)",
    positionals: [{ name: 'code', description: 'Code to run; omit to read stdin' }],
    flags: {
      helpers: { type: 'boolean', description: 'List the helpers in scope and exit' },
    },
  },

  async execute(args: ParsedArgs, resolveSession: SessionResolver) {
    if (args.flags.get('helpers')) {
      const workspace = await loadWorkspaceHelpers()
      const builtin = Object.keys(buildHelpers({} as RelayApiClient, '0'))
      console.log('Built in:')
      for (const name of builtin.sort()) console.log(`  ${name}`)
      console.log(`\nFrom ${WORKSPACE_HELPERS}:`)
      const names = Object.keys(workspace)
      if (names.length === 0) {
        console.log('  (none yet — export a function from that file and it appears here)')
      } else {
        for (const name of names.sort()) console.log(`  ${name}`)
      }
      return
    }

    const code = args.positionals[0] ?? (process.stdin.isTTY ? '' : await readStdin())
    if (!code.trim()) {
      throw new Error('Nothing to run. Pass code as an argument or pipe it on stdin.')
    }

    const { sessionId, client } = await resolveSession(args)
    const helpers = { ...buildHelpers(client, sessionId), ...(await loadWorkspaceHelpers()) }

    const names = Object.keys(helpers)
    let run: (...values: unknown[]) => Promise<unknown>
    try {
      run = new AsyncFunction(...names, code)
    } catch (error: any) {
      // A syntax error here is in the caller's snippet, not in this file, and
      // saying so saves a look at the wrong stack trace.
      throw new Error(`Snippet failed to parse: ${error.message}`)
    }

    const result = await run(...names.map((name) => helpers[name as keyof typeof helpers]))
    if (result === undefined) return
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
  },
})
