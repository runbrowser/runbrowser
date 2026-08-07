/**
 * Execution commands: cdp, eval
 *
 * These two are the whole browser API. Everything the old verb layer did —
 * clicking, typing, reading the page, screenshots — is a CDP method the model
 * already knows, so it goes through `cdp` rather than through a wrapper we
 * have to name, document and version.
 */

import { registerBuiltinCommand } from './index.js'
import { output } from '../output.js'

/**
 * Read all of stdin. Used when a command's payload is piped or heredoc'd
 * instead of passed as an argument — multi-line JS and large CDP params are
 * unpleasant to quote on a command line.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

/** True when stdin is a pipe or a file rather than a terminal. */
function stdinIsPiped(): boolean {
  return !process.stdin.isTTY
}

// ============================================================================
// cdp
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'cdp',
    description: 'Send a raw CDP command — the full Chrome DevTools Protocol',
    usage: "runbrowser cdp <method> [params-json]   (params may also be piped on stdin)",
    positionals: [
      { name: 'method', description: 'CDP method, e.g. Page.navigate', required: true },
      { name: 'params', description: 'JSON params object' },
    ],
  },
  async execute(args, resolveSession) {
    const method = args.subcommand
    if (!method) throw new Error('Usage: runbrowser cdp <method> [params-json]')

    let raw = args.positionals[0]
    if (raw == null && stdinIsPiped()) {
      const piped = (await readStdin()).trim()
      if (piped) raw = piped
    }

    let params: unknown
    if (raw != null && raw !== '') {
      try {
        params = JSON.parse(raw)
      } catch {
        throw new Error(`Invalid JSON params: ${raw}`)
      }
    }

    const { sessionId, client } = await resolveSession(args)
    const result = await client.cdp(sessionId, method, params)
    console.log(JSON.stringify(result.result, null, 2))
  },
})

// ============================================================================
// eval
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'eval',
    description: 'Run JavaScript in the page — shorthand for Runtime.evaluate',
    usage: "runbrowser eval '<js>'   (code may also be piped on stdin)",
    positionals: [
      { name: 'code', description: 'JavaScript to execute', required: true },
    ],
    flags: {
      timeout: { type: 'number', description: 'Timeout in ms', default: 10000 },
    },
  },
  async execute(args, resolveSession) {
    let code = args.subcommand
    if (!code && stdinIsPiped()) {
      const piped = (await readStdin()).trim()
      if (piped) code = piped
    }
    if (!code) throw new Error('Usage: runbrowser eval <code>')

    const timeout = (args.flags.get('timeout') as number) ?? 10000
    const { sessionId, client } = await resolveSession(args)
    const result = await client.evaluate(sessionId, code, timeout)
    if (!result.text) return
    if (result.isError) {
      console.error(result.text)
      process.exit(1)
    }
    if (args.json) output({ value: result.text }, true)
    else console.log(result.text)
  },
})
