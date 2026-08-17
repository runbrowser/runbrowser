/**
 * runbrowser-mcp — MCP server for RunBrowser.
 *
 * Exposes 7 semantic tools (skill, navigate, interact, query, eval, cdp, command)
 * that proxy to the local relay server, which speaks CDP to your running Chrome
 * via the RunBrowser extension.
 */

export { startMcp, server } from './server.js'
