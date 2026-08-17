/**
 * MCP server command.
 *
 * The MCP server speaks JSON-RPC over stdio, so this command must never write
 * to stdout itself — everything it has to say goes to stderr.
 */

import { registerBuiltinCommand } from './index.js'

registerBuiltinCommand({
  def: {
    name: 'mcp',
    description: 'Run the MCP server on stdio, for Claude Code / Cursor and friends',
    usage: 'runbrowser mcp [--host <host>] [--token <token>]',
  },
  async execute(args) {
    const { startMcp } = await import('../../mcp/server.js')
    await startMcp({
      host: args.host || process.env.RUNBROWSER_HOST,
      token: args.token || process.env.RUNBROWSER_TOKEN,
    })
  },
})
