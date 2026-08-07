import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { VERSION } from '@jiweiyuan/runbrowser-server'
import { RelayApiClient } from '@jiweiyuan/runbrowser-server/api'

// ============================================================================
// Relay API Client
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

async function ensureSession(): Promise<string> {
  const c = getClient()

  if (!c.isRemote) {
    await c.ensureServer()
  }

  if (sessionId) {
    return sessionId
  }

  await c.waitForExtensions({ timeoutMs: 15000, pollIntervalMs: 500 })

  const session = await c.createSession({ cwd: process.cwd() })
  sessionId = session.id
  mcpLog(`MCP session created: ${sessionId}`)
  return sessionId
}

// ============================================================================
// Result helpers
// ============================================================================

type ContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

type ToolResult = { content: ContentItem[]; isError?: boolean }

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

function errorResult(msg: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
}

function toolHandler<T extends Record<string, unknown>>(
  fn: (args: T) => Promise<ToolResult>,
): (args: T) => Promise<ToolResult> {
  return async (args) => {
    try {
      return await fn(args)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('404')) sessionId = null
      return errorResult(msg)
    }
  }
}

function requireField<T>(value: T | undefined, name: string, action: string): T {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${name} required for action="${action}"`)
  }
  return value
}

// ============================================================================
// MCP Server — 7 semantic tools
// ============================================================================

const server = new McpServer({
  name: 'runbrowser',
  title: 'Control your running Chrome browser — your logins, extensions, cookies already there.',
  version: VERSION,
})

// ── skill: discover available tools, CLI commands, and site commands ──

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadSkillContent(): string {
  const candidates = [
    path.join(__dirname, '..', 'src', 'skill.md'),
    path.join(__dirname, '..', '..', 'src', 'skill.md'),
    path.join(__dirname, 'skill.md'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8')
  }
  return 'RunBrowser skill file not found. Use `runbrowser --help` for available commands.'
}

server.tool(
  'skill',
  `Show the full RunBrowser reference and the site commands registered here.
Call this first: it covers how to read a page with the accessibility tree, how
to click and type via CDP, and the \`eval\` wrapping caveat.`,
  {},
  toolHandler(async () => {
    let content = loadSkillContent()

    try {
      const c = getClient()
      await c.ensureServer()
      const commands = await c.listCommands()
      if (commands && commands.length > 0) {
        content += '\n\n## Site Commands\n\n'
        content += commands.map((cmd: any) => {
          const argStr = cmd.args
            ? Object.entries(cmd.args).map(([name, def]: [string, any]) =>
                def.required ? ` <${name}>` : ` [--${name}]`
              ).join('')
            : ''
          return `command({ site: "${cmd.site}", name: "${cmd.name}"${argStr ? `, args: { /* ${argStr.trim()} */ }` : ''} })  # ${cmd.description}`
        }).join('\n')
      }
    } catch {
      // Relay not running — return static content
    }

    return textResult(content)
  }),
)

// ── status: is a browser attached ──

server.tool(
  'status',
  `Report whether the relay is up and a browser extension is attached.
Call this when a browser call fails — it distinguishes "no browser connected"
from a genuine page error. It does not start or change anything.`,
  {},
  toolHandler(async () => {
    const c = getClient()
    const extensions = await c.fetchExtensionsStatus().catch(() => [])
    const sessions = await c.listSessions().catch(() => [])
    if (extensions.length === 0) {
      return textResult(
        'No browser attached. Ask the user to click the RunBrowser extension icon on a tab.',
      )
    }
    const who = extensions
      .map((e: any) => `${e.browser || 'Chrome'} ${e.profile?.email || '(not signed in)'}`)
      .join(', ')
    return textResult(`Attached: ${who}\nSessions: ${sessions.length}`)
  }),
)

// ── tab: which target the session is bound to ──

server.tool(
  'tab',
  `List, open, switch and close browser tabs.

Tabs are connection state, not page state — everything you do *to* a page goes
through \`cdp\`. The "action" field selects behavior:
  • list   — page targets, with the bound one marked
  • new    — open a tab (optional "url") and bind to it
  • switch — bind to the tab at "index"
  • close  — close the tab at "index", or the bound one if omitted`,
  {
    action: z.enum(['list', 'new', 'switch', 'close']).describe('Tab action'),
    url: z.string().optional().describe('URL for action="new"'),
    index: z.number().optional().describe('Tab index for switch/close'),
  },
  toolHandler(async ({ action, url, index }) => {
    const sid = await ensureSession()
    const c = getClient()
    switch (action) {
      case 'list': {
        const r = await c.listTabs(sid)
        return textResult(
          r.tabs
            .map((t: any) => `${t.active ? '→' : ' '} [${t.index}] ${t.title || '(untitled)'} — ${t.url}`)
            .join('\n') || '(no tabs)',
        )
      }
      case 'new': {
        const r = await c.newTab(sid, url)
        return textResult(`Opened tab ${r.index}${url ? ` at ${url}` : ''}`)
      }
      case 'switch': {
        const i = requireField(index, 'index', 'switch')
        await c.switchTab(sid, i)
        return textResult(`Switched to tab ${i}`)
      }
      case 'close': {
        await c.closeTab(sid, index)
        return textResult(`Closed tab${index != null ? ` ${index}` : ''}`)
      }
    }
  }),
)

// ── eval: JS in page context ──

server.tool(
  'eval',
  `Run JavaScript in the browser page context. Returns the result as text plus any images logged via console.image / runbrowser.image.
The code runs inside the page — \`document\`, \`window\`, \`fetch\` are available; Playwright APIs are not.`,
  {
    code: z.string().describe('JavaScript code to evaluate'),
    timeout: z.number().optional().describe('Timeout in ms (default 10000)'),
  },
  toolHandler(async ({ code, timeout }) => {
    const sid = await ensureSession()
    const c = getClient()
    const result = await c.evaluate(sid, code, timeout)
    const content: ContentItem[] = [{ type: 'text', text: result.text }]
    for (const img of result.images) {
      content.push({ type: 'image', data: img.data, mimeType: img.mimeType })
    }
    return { content, isError: result.isError }
  }),
)

// ── cdp: raw Chrome DevTools Protocol ──

server.tool(
  'cdp',
  `Send a Chrome DevTools Protocol command. This is the page API — there are no
click/type/read tools, because those are all CDP methods you already know.

  cdp({ method: "Page.navigate", params: { url: "https://example.com" } })
  cdp({ method: "Accessibility.getFullAXTree" })   // find elements; filter the result yourself
  cdp({ method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x, y, button: "left", clickCount: 1 } })
  cdp({ method: "Page.captureScreenshot", params: { format: "png" } })

Read the page before acting on it: getFullAXTree returns roles, names and
backendNodeIds; resolve a node's box with DOM.getBoxModel and click its centre.
Prefer that over screenshots — it is cheaper and searchable.`,
  {
    method: z.string().describe('CDP method (e.g. "Page.captureScreenshot")'),
    params: z.record(z.string(), z.unknown()).optional().describe('CDP params object'),
  },
  toolHandler(async ({ method, params }) => {
    const sid = await ensureSession()
    const c = getClient()
    const result = await c.cdp(sid, method, params)
    return textResult(JSON.stringify(result.result, null, 2))
  }),
)

// ── command: extension-defined site commands ──

server.tool(
  'command',
  `Run an extension-defined site command. Use \`skill\` to discover what's available.

Example:
  command({ site: "github", name: "trending", args: { limit: 5 } })`,
  {
    site: z.string().describe('Site name (e.g. "github")'),
    name: z.string().describe('Command name (e.g. "trending")'),
    args: z.record(z.string(), z.unknown()).optional().describe('Command arguments'),
  },
  toolHandler(async ({ site, name, args }) => {
    const sid = await ensureSession()
    const c = getClient()
    const result = await c.runCommand(sid, site, name, args ?? {})
    return textResult(JSON.stringify(result.data, null, 2))
  }),
)

// ============================================================================
export { server }

export async function startMcp(options: { host?: string; token?: string } = {}) {
  if (options.host) {
    process.env.RUNBROWSER_HOST = options.host
  }
  if (options.token) {
    process.env.RUNBROWSER_TOKEN = options.token
  }

  const c = getClient()
  if (c.isRemote) {
    mcpLog(`Using remote CDP relay server: ${options.host}`)
  }
  await c.ensureServer()

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
