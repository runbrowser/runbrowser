/**
 * MCP server — delegates to @runbrowser/mcp.
 *
 * The MCP server implementation lives in the dedicated @runbrowser/mcp package.
 * This module re-exports it so `runbrowser/mcp` and `import('./mcp.js')` in
 * the CLI keep working.
 */
export { startMcp, server } from '@runbrowser/mcp'
