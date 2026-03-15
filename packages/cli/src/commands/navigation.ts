/**
 * Navigation commands: navigate, back, forward, reload, close
 */

import { registerBuiltinCommand, type SessionResolver } from './index.js'
import type { ParsedArgs } from '../args.js'
import { output, ok } from '../output.js'

// ============================================================================
// navigate
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'navigate',
    aliases: ['open', 'goto'],
    description: 'Navigate to a URL',
    positionals: [
      { name: 'url', description: 'URL to navigate to', required: true },
    ],
  },
  async execute(args: ParsedArgs, resolveSession: SessionResolver) {
    const url = args.subcommand
    if (!url) throw new Error('URL required: runbrowser navigate <url>')

    const { sessionId, client } = await resolveSession(args)
    const result = await client.navigate(sessionId, url)
    output({ url: result.url, title: result.title }, args.json)
  },
})

// ============================================================================
// back
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'back',
    description: 'Go back in history',
  },
  async execute(args: ParsedArgs, resolveSession: SessionResolver) {
    const { sessionId, client } = await resolveSession(args)
    await client.back(sessionId)
    ok('Navigated back', args.json)
  },
})

// ============================================================================
// forward
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'forward',
    description: 'Go forward in history',
  },
  async execute(args: ParsedArgs, resolveSession: SessionResolver) {
    const { sessionId, client } = await resolveSession(args)
    await client.forward(sessionId)
    ok('Navigated forward', args.json)
  },
})

// ============================================================================
// reload
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'reload',
    description: 'Reload the page',
  },
  async execute(args: ParsedArgs, resolveSession: SessionResolver) {
    const { sessionId, client } = await resolveSession(args)
    await client.reload(sessionId)
    ok('Reloaded', args.json)
  },
})

// ============================================================================
// close
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'close',
    aliases: ['quit', 'exit'],
    description: 'Close browser session',
  },
  async execute(args: ParsedArgs, resolveSession: SessionResolver) {
    const { sessionId, client } = await resolveSession(args)
    await client.deleteSession(sessionId)
    ok(`Session ${sessionId} closed`, args.json)
  },
})
