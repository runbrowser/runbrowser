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

/**
 * Read the payload from stdin only when the caller asked for it with `-`.
 *
 * Treating "stdin is not a TTY" as "a payload is coming" hangs forever when a
 * parent process holds an idle pipe open — which is the normal shape of a
 * command spawned by an agent harness. `cdp Page.captureScreenshot` takes no
 * params, so it would block waiting for input nobody is going to send.
 */
async function payloadFromStdinIfRequested(raw: string | undefined): Promise<string | undefined> {
  if (raw !== '-') return raw
  const piped = (await readStdin()).trim()
  return piped || undefined
}

// ============================================================================
// cdp
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'cdp',
    description: 'Send a raw CDP command — the full Chrome DevTools Protocol',
    usage: "runbrowser cdp <method> [params-json | -]   (- reads params from stdin)",
    positionals: [
      { name: 'method', description: 'CDP method, e.g. Page.navigate', required: true },
      { name: 'params', description: "JSON params object, or - to read from stdin" },
    ],
  },
  async execute(args, resolveSession) {
    const method = args.subcommand
    if (!method) throw new Error('Usage: runbrowser cdp <method> [params-json]')

    const raw = await payloadFromStdinIfRequested(args.positionals[0])

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
    // `eval` always needs a payload, so bare `runbrowser eval` with something
    // piped in is unambiguous and reading it is safe. `-` also works.
    let code = args.subcommand === '-' ? undefined : args.subcommand
    if (!code && !process.stdin.isTTY) {
      const piped = (await readStdin()).trim()
      if (piped) code = piped
    }
    if (!code) throw new Error("Usage: runbrowser eval <code>   (or pipe it in)")

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
