/**
 * Navigation commands: navigate, back, forward, reload, close
 */

import { registerBuiltinCommand, type SessionResolver } from './index.js'
import type { ParsedArgs } from '../args.js'
import { output, ok, die } from '../output.js'

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
    if (!url) die('URL required: runbrowser navigate <url>')

    const { sessionId, client } = await resolveSession(args)
    try {
      const result = await client.navigate(sessionId, url)
      output({ url: result.url, title: result.title }, args.json)
    } catch (e: any) { die(e.message) }
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
    try { await client.back(sessionId); ok('Navigated back', args.json) }
    catch (e: any) { die(e.message) }
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
    try { await client.forward(sessionId); ok('Navigated forward', args.json) }
    catch (e: any) { die(e.message) }
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
    try { await client.reload(sessionId); ok('Reloaded', args.json) }
    catch (e: any) { die(e.message) }
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
    try {
      await client.deleteSession(sessionId)
      ok(`Session ${sessionId} closed`, args.json)
    } catch (e: any) { die(e.message) }
  },
})
