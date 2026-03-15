/**
 * Execution commands: eval, cdp, diff
 */

import { registerBuiltinCommand, type SessionResolver } from './index.js'
import type { ParsedArgs } from '../args.js'
import { output } from '../output.js'

// ============================================================================
// eval
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'eval',
    description: 'Run JavaScript in the browser page context',
    positionals: [
      { name: 'code', description: 'JavaScript code to execute', required: true },
    ],
    flags: {
      timeout: { type: 'number', description: 'Timeout in ms', default: 10000 },
    },
  },
  async execute(args, resolveSession) {
    const code = args.subcommand
    if (!code) throw new Error('Usage: runbrowser eval <code>')
    const timeout = (args.flags.get('timeout') as number) ?? 10000
    const { sessionId, client } = await resolveSession(args)
    const result = await client.evaluate(sessionId, code, timeout)
    if (result.text) {
      if (result.isError) { console.error(result.text); process.exit(1) }
      else if (args.json) output({ value: result.text }, true)
      else console.log(result.text)
    }
  },
})

// ============================================================================
// cdp
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'cdp',
    description: 'Send a raw CDP command (Chrome DevTools Protocol)',
    positionals: [
      { name: 'method', description: 'CDP method (e.g. Page.captureScreenshot)', required: true },
      { name: 'params', description: 'JSON params' },
    ],
  },
  async execute(args, resolveSession) {
    const method = args.subcommand
    if (!method) throw new Error('Usage: runbrowser cdp <method> [params]')
    const { sessionId, client } = await resolveSession(args)
    // Parse params separately — SyntaxError needs a specific message
    let params: unknown
    if (args.positionals[0]) {
      try { params = JSON.parse(args.positionals[0]) }
      catch { throw new Error(`Invalid JSON params: ${args.positionals[0]}`) }
    }
    const result = await client.cdp(sessionId, method, params)
    console.log(JSON.stringify(result.result, null, 2))
  },
})

// ============================================================================
// diff
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'diff',
    description: 'Compare states: snapshot, screenshot',
    positionals: [
      { name: 'type', description: 'snapshot or screenshot', required: true },
    ],
    flags: {
      baseline: { type: 'string', alias: 'b', description: 'Baseline file to compare against' },
      output:   { type: 'string', alias: 'o', description: 'Output file for diff (screenshot only)' },
    },
  },
  async execute(args, resolveSession) {
    const type = args.subcommand
    if (!type) throw new Error('Usage: runbrowser diff <snapshot|screenshot>')
    const { sessionId, client } = await resolveSession(args)
    if (type === 'snapshot') {
      const baseline = args.flags.get('baseline') as string | undefined
      const r = await client.diffSnapshot(sessionId, baseline)
      if (args.json) console.log(JSON.stringify(r))
      else console.log(r.diff)
    } else if (type === 'screenshot') {
      const baseline = args.flags.get('baseline') as string
      if (!baseline) throw new Error('--baseline is required for screenshot diff')
      const out = args.flags.get('output') as string | undefined
      const r = await client.diffScreenshot(sessionId, baseline, out)
      if (args.json) console.log(JSON.stringify(r))
      else console.log(`Diff saved to ${r.path}`)
    } else {
      throw new Error(`Unknown diff type: ${type}. Use: snapshot, screenshot`)
    }
  },
})
