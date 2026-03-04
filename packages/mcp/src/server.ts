import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import dedent from 'string-dedent'
import { LOG_FILE_PATH, VERSION } from '@agmod/runbrowser-relay'
import { RelayApiClient } from '@agmod/runbrowser-relay/api'

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

const server = new McpServer({
  name: 'runbrowser',
  title: 'Control your running Chrome browser — your logins, extensions, cookies already there.',
  version: VERSION,
})

// System prompt teaching AI agents how to use the new tool set
const systemPrompt = dedent`
  You are controlling a real Chrome browser. The browser already has the user's logins, extensions, and cookies.

  ## Workflow
  1. Use \`snapshot\` to see the current page (returns accessibility tree with @ref labels on interactive elements)
  2. Use @ref labels from snapshot to interact: \`click @e1\`, \`fill @e2 with "text"\`
  3. Use \`evaluate\` for complex JS operations the high-level tools can't do
  4. Re-snapshot after actions to verify results
  5. Use \`screenshot\` when you need visual layout information

  ## Element References
  - \`snapshot\` returns elements tagged with @e1, @e2, etc.
  - Pass these refs to \`click\`, \`fill\`, \`hover\`, \`get_text\`
  - Refs are valid until the next \`snapshot\` call

  for debugging internal runbrowser errors, check runbrowser relay server logs at: ${LOG_FILE_PATH}
`

// ============================================================================
// Helper: wrap tool handler with error handling and 404 session reset
// ============================================================================
function toolHandler<T extends Record<string, unknown>>(
  fn: (args: T) => Promise<{ content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>; isError?: boolean }>,
): (args: T) => Promise<{ content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>; isError?: boolean }> {
  return async (args) => {
    try {
      return await fn(args)
    } catch (error: any) {
      const msg = error.message || String(error)
      if (msg.includes('404')) sessionId = null
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
    }
  }
}

// ============================================================================
// MCP Tools
// ============================================================================

server.tool(
  'navigate',
  'Navigate to a URL in the browser.',
  { url: z.string().describe('The URL to navigate to') },
  toolHandler(async ({ url }) => {
    const sid = await ensureSession()
    const result = await getClient().navigate(sid, url)
    return { content: [{ type: 'text', text: `Navigated to ${result.url}\nTitle: ${result.title}` }] }
  }),
)

server.tool(
  'snapshot',
  systemPrompt + '\n\nTake an accessibility snapshot of the current page. Returns a text representation with @ref labels on interactive elements. Use refs for click/fill/hover.',
  { interactiveOnly: z.boolean().default(false).describe('Only include interactive elements') },
  toolHandler(async ({ interactiveOnly }) => {
    const sid = await ensureSession()
    const result = await getClient().snapshot(sid, { interactiveOnly })
    return { content: [{ type: 'text', text: result.snapshot }] }
  }),
)

server.tool(
  'screenshot',
  'Take a screenshot of the current page. Use when you need visual/spatial information.',
  {},
  toolHandler(async () => {
    const sid = await ensureSession()
    const result = await getClient().captureScreenshot(sid)
    return {
      content: [
        { type: 'text', text: 'Screenshot captured.' },
        { type: 'image', data: result.data, mimeType: result.mimeType },
      ],
    }
  }),
)

server.tool(
  'click',
  'Click an element by its @ref from snapshot (e.g. "@e1") or CSS selector.',
  { ref: z.string().describe('Element ref from snapshot (e.g. "@e1") or CSS selector') },
  toolHandler(async ({ ref }) => {
    const sid = await ensureSession()
    await getClient().click(sid, ref)
    return { content: [{ type: 'text', text: `Clicked ${ref}` }] }
  }),
)

server.tool(
  'fill',
  'Fill an input field by its @ref from snapshot or CSS selector.',
  {
    ref: z.string().describe('Element ref from snapshot (e.g. "@e2") or CSS selector'),
    value: z.string().describe('Value to fill in'),
  },
  toolHandler(async ({ ref, value }) => {
    const sid = await ensureSession()
    await getClient().fill(sid, ref, value)
    return { content: [{ type: 'text', text: `Filled ${ref} with "${value}"` }] }
  }),
)

server.tool(
  'type',
  'Type text with the keyboard at the current focus position.',
  { text: z.string().describe('Text to type') },
  toolHandler(async ({ text }) => {
    const sid = await ensureSession()
    await getClient().type(sid, text)
    return { content: [{ type: 'text', text: `Typed "${text}"` }] }
  }),
)

server.tool(
  'press',
  'Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.).',
  { key: z.string().describe('Key name: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, etc.') },
  toolHandler(async ({ key }) => {
    const sid = await ensureSession()
    await getClient().press(sid, key)
    return { content: [{ type: 'text', text: `Pressed ${key}` }] }
  }),
)

server.tool(
  'scroll',
  'Scroll the page in a direction.',
  {
    direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction'),
    amount: z.number().optional().describe('Scroll amount in pixels (default: 300)'),
  },
  toolHandler(async ({ direction, amount }) => {
    const sid = await ensureSession()
    await getClient().scroll(sid, direction, amount)
    return { content: [{ type: 'text', text: `Scrolled ${direction}${amount ? ` by ${amount}px` : ''}` }] }
  }),
)

server.tool(
  'hover',
  'Hover over an element by its @ref from snapshot.',
  { ref: z.string().describe('Element ref from snapshot (e.g. "@e3")') },
  toolHandler(async ({ ref }) => {
    const sid = await ensureSession()
    await getClient().hover(sid, ref)
    return { content: [{ type: 'text', text: `Hovered over ${ref}` }] }
  }),
)

server.tool(
  'evaluate',
  'Run JavaScript code directly in the browser. The code runs in the page context.',
  {
    code: z.string().describe('JavaScript code to execute in the browser. Top-level await is supported.'),
    timeout: z.number().default(10000).describe('Timeout in milliseconds'),
  },
  toolHandler(async ({ code, timeout }) => {
    const sid = await ensureSession()
    const result = await getClient().evaluate(sid, code, timeout)
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
      { type: 'text', text: result.text },
    ]
    for (const img of result.images) {
      content.push({ type: 'image', data: img.data, mimeType: img.mimeType })
    }
    return { content, isError: result.isError }
  }),
)

server.tool(
  'get_url',
  'Get the current page URL.',
  {},
  toolHandler(async () => {
    const sid = await ensureSession()
    const result = await getClient().getUrl(sid)
    return { content: [{ type: 'text', text: result.url }] }
  }),
)

server.tool(
  'get_title',
  'Get the current page title.',
  {},
  toolHandler(async () => {
    const sid = await ensureSession()
    const result = await getClient().getTitle(sid)
    return { content: [{ type: 'text', text: result.title }] }
  }),
)

server.tool(
  'back',
  'Navigate back in browser history.',
  {},
  toolHandler(async () => {
    const sid = await ensureSession()
    await getClient().back(sid)
    return { content: [{ type: 'text', text: 'Navigated back' }] }
  }),
)

server.tool(
  'forward',
  'Navigate forward in browser history.',
  {},
  toolHandler(async () => {
    const sid = await ensureSession()
    await getClient().forward(sid)
    return { content: [{ type: 'text', text: 'Navigated forward' }] }
  }),
)

server.tool(
  'reload',
  'Reload the current page.',
  {},
  toolHandler(async () => {
    const sid = await ensureSession()
    await getClient().reload(sid)
    return { content: [{ type: 'text', text: 'Page reloaded' }] }
  }),
)

server.tool(
  'reset',
  'Reset the browser connection. Use when you get connection errors or the browser seems stuck.',
  {},
  toolHandler(async () => {
    const sid = await ensureSession()
    const result = await getClient().reset(sid)
    return {
      content: [{ type: 'text', text: `Connection reset. Current URL: ${result.pageUrl}` }],
    }
  }),
)

// Keep execute tool for backwards compatibility with existing MCP clients
server.tool(
  'execute',
  'Run JavaScript in the browser context. Prefer using the specific tools (navigate, click, fill, snapshot) instead. Use this for complex operations not covered by other tools.',
  {
    code: z.string().describe('JavaScript code to execute in the browser. Top-level await is supported.'),
    timeout: z.number().default(10000).describe('Timeout in milliseconds'),
  },
  toolHandler(async ({ code, timeout }) => {
    const sid = await ensureSession()
    const result = await getClient().evaluate(sid, code, timeout)
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
      { type: 'text', text: result.text },
    ]
    for (const img of result.images) {
      content.push({ type: 'image', data: img.data, mimeType: img.mimeType })
    }
    return { content, isError: result.isError }
  }),
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
