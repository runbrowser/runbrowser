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
    usage: 'termio-browser mcp [--host <host>] [--token <token>]',
  },
  async execute(args) {
    const { startMcp } = await import('../../mcp/server.js')
    await startMcp({
      host: args.host || process.env.TERMIO_BROWSER_HOST,
      token: args.token || process.env.TERMIO_BROWSER_TOKEN,
    })
  },
})
