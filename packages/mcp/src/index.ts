/**
 * @runbrowser/mcp — MCP server for RunBrowser.
 *
 * Provides a Model Context Protocol server that exposes browser automation
 * tools (execute, reset, snapshot, screenshot) backed by Playwright,
 * connecting to your running Chrome via the RunBrowser extension.
 */

export { startMcp, server } from './server.js'
