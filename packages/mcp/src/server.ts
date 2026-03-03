import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import dedent from 'string-dedent'
import { LOG_FILE_PATH, VERSION } from '@runbrowser/relay'
import { RelayApiClient } from '@runbrowser/relay/api'

const require = createRequire(import.meta.url)

// ============================================================================
// Relay API Client instance — single client for this MCP server process
// ============================================================================

let client: RelayApiClient | null = null
let sessionId: string | null = null

function getClient(): RelayApiClient {
  if (!client) {
    client = new RelayApiClient({
      host: process.env.RUNBROWSER_HOST,
      token: process.env.RUNBROWSER_TOKEN,
      logger: mcpLogger,
    })
  }
  return client
}

/**
 * Log to both console.error (for early startup) and relay server log file.
 */
function mcpLog(...args: any[]) {
  console.error(...args)
  getClient().sendLog('log', ...args)
}

const mcpLogger = {
  log: (...args: any[]) => mcpLog(...args),
  error: (...args: any[]) => {
    console.error(...args)
    getClient().sendLog('error', ...args)
  },
}

/**
 * Ensure relay server is running and we have a session.
 */
async function ensureSession(): Promise<string> {
  const c = getClient()

  // Ensure relay server is running
  if (!c.isRemote) {
    await c.ensureServer()
  }

  if (sessionId) {
    return sessionId
  }

  // Wait for extension
  await c.waitForExtensions({ timeoutMs: 15000, pollIntervalMs: 500 })

  // Create session
  const session = await c.createSession({ cwd: process.cwd() })
  sessionId = session.id
  mcpLog(`MCP session created: ${sessionId}`)
  return sessionId
}

// ============================================================================
// MCP Server Definition
// ============================================================================

/** Resolve a resource file from the @runbrowser/core package dist/ directory */
function resolveCoreDistFile(filename: string): string {
  const corePkgDir = path.dirname(require.resolve('@runbrowser/core/package.json'))
  return fs.readFileSync(path.join(corePkgDir, 'dist', filename), 'utf-8')
}

const server = new McpServer({
  name: 'runbrowser',
  title: 'Control your running Chrome browser via Playwright — your logins, extensions, cookies already there.',
  version: VERSION,
})

const promptContent =
  resolveCoreDistFile('prompt.md') +
  `\n\nfor debugging internal runbrowser errors, check runbrowser relay server logs at: ${LOG_FILE_PATH}`

server.resource(
  'debugger-api',
  'runbrowser://resources/debugger-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const content = resolveCoreDistFile('debugger-api.md')
    return {
      contents: [{ uri: 'runbrowser://resources/debugger-api.md', text: content, mimeType: 'text/plain' }],
    }
  },
)

server.resource(
  'editor-api',
  'runbrowser://resources/editor-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const content = resolveCoreDistFile('editor-api.md')
    return {
      contents: [{ uri: 'runbrowser://resources/editor-api.md', text: content, mimeType: 'text/plain' }],
    }
  },
)

server.resource(
  'styles-api',
  'runbrowser://resources/styles-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const content = resolveCoreDistFile('styles-api.md')
    return {
      contents: [{ uri: 'runbrowser://resources/styles-api.md', text: content, mimeType: 'text/plain' }],
    }
  },
)

server.tool(
  'execute',
  promptContent,
  {
    code: z
      .string()
      .describe(
        'js playwright code, has {page, state, context} in scope. Should be one line, using ; to execute multiple statements. you MUST call execute multiple times instead of writing complex scripts in a single tool call.',
      ),
    timeout: z.number().default(10000).describe('Timeout in milliseconds for code execution (default: 10000ms)'),
  },
  async ({ code, timeout }) => {
    try {
      const sid = await ensureSession()
      const c = getClient()
      const result = await c.execute(sid, code, timeout)

      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text', text: result.text },
      ]

      for (const image of result.images) {
        content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
      }

      if (result.isError) {
        return { content, isError: true }
      }

      return { content }
    } catch (error: any) {
      const errorMessage = error.message || String(error)
      const isTimeoutError = error.name === 'TimeoutError' || error.name === 'AbortError'

      console.error('Error in execute tool:', errorMessage)
      if (!isTimeoutError) {
        getClient().sendLog('error', 'Error in execute tool:', errorMessage)
      }

      // Clear session on 404 so next call creates a new one
      if (errorMessage.includes('404')) {
        sessionId = null
      }

      const resetHint = isTimeoutError
        ? ''
        : '\n\n[HINT: If this is an internal Playwright error, page/browser closed, or connection issue, call the `reset` tool to reconnect. Do NOT reset for other non-connection non-internal errors.]'

      return {
        content: [{ type: 'text', text: `Error executing code: ${errorMessage}${resetHint}` }],
        isError: true,
      }
    }
  },
)

server.tool(
  'reset',
  dedent`
    Recreates the CDP connection and resets the browser/page/context. Use this when the MCP stops responding, you get connection errors, if there are no pages in context, assertion failures, page closed, or other issues.

    After calling this tool, the page and context variables are automatically updated in the execution environment.

    This tools also removes any custom properties you may have added to the global scope AND clearing all keys from the \`state\` object. Only \`page\`, \`context\`, \`state\` (empty), \`console\`, and utility functions will remain.

    if playwright always returns all pages as about:blank urls and evaluate does not work you should ask the user to restart Chrome. This is a known Chrome bug.
  `,
  {},
  async () => {
    try {
      const sid = await ensureSession()
      const c = getClient()
      const result = await c.reset(sid)

      return {
        content: [
          {
            type: 'text',
            text: `Connection reset successfully. ${result.pagesCount} page(s) available. Current page URL: ${result.pageUrl}`,
          },
        ],
      }
    } catch (error: any) {
      if (error.message?.includes('404')) {
        sessionId = null
      }
      return {
        content: [{ type: 'text', text: `Failed to reset connection: ${error.message}` }],
        isError: true,
      }
    }
  },
)

server.tool(
  'snapshot',
  dedent`
    Take an accessibility snapshot of the current page. Returns a text representation of the page's accessibility tree showing all interactive elements with their roles, names, and locator selectors.
    
    This is the primary way to understand page state. Use it before and after every action to verify what happened. Much cheaper and faster than screenshots.
  `,
  {
    search: z.string().optional().describe('Filter snapshot results by string or regex pattern'),
    interactiveOnly: z.boolean().default(false).describe('Only include interactive elements (default: false)'),
  },
  async ({ search, interactiveOnly }) => {
    try {
      const sid = await ensureSession()
      const c = getClient()

      const searchPattern = search || undefined
      const code = `await snapshot({ page, search: ${searchPattern ? `"${searchPattern.replace(/"/g, '\\"')}"` : 'undefined'}, interactiveOnly: ${interactiveOnly} })`
      const result = await c.execute(sid, code, 10000)

      return {
        content: [{ type: 'text', text: result.text }],
        isError: result.isError,
      }
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to take snapshot: ${error.message}` }],
        isError: true,
      }
    }
  },
)

server.tool(
  'screenshot',
  dedent`
    Take a screenshot of the current page with accessibility labels overlaid on interactive elements (Vimium-style).
    Returns both the image and the accessibility snapshot text.
    
    Use this when you need visual/spatial information — for text content, use the snapshot tool instead.
  `,
  {},
  async () => {
    try {
      const sid = await ensureSession()
      const c = getClient()

      const result = await c.execute(sid, 'await screenshotWithAccessibilityLabels({ page })', 20000)

      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text', text: result.text },
      ]

      for (const image of result.images) {
        content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
      }

      return { content, isError: result.isError }
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to take screenshot: ${error.message}` }],
        isError: true,
      }
    }
  },
)

export { server }

export async function startMcp(options: { host?: string; token?: string } = {}) {
  if (options.host) {
    process.env.RUNBROWSER_HOST = options.host
  }
  if (options.token) {
    process.env.RUNBROWSER_TOKEN = options.token
  }

  // Initialize client and ensure server
  const c = getClient()
  if (c.isRemote) {
    mcpLog(`Using remote CDP relay server: ${options.host}`)
  }
  await c.ensureServer()

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
