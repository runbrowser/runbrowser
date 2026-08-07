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
  `Show RunBrowser usage, available CLI commands, and registered site commands.
Call this first to learn the @ref selector model and what site commands are available.`,
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

// ── navigate: page-level navigation ──

server.tool(
  'navigate',
  `Page-level navigation. The "action" field determines behavior:
  • goto    — load a URL (requires "url")
  • back    — history back
  • forward — history forward
  • reload  — reload current page
  • reset   — reset the relay connection (use if commands hang)`,
  {
    action: z.enum(['goto', 'back', 'forward', 'reload', 'reset'])
      .describe('Navigation action'),
    url: z.string().optional()
      .describe('Target URL — required when action="goto"'),
  },
  toolHandler(async ({ action, url }) => {
    const sid = await ensureSession()
    const c = getClient()
    switch (action) {
      case 'goto': {
        const u = requireField(url, 'url', 'goto')
        const r = await c.navigate(sid, u)
        return textResult(`Navigated to ${r.url}\nTitle: ${r.title}`)
      }
      case 'back':    await c.back(sid);    return textResult('Navigated back')
      case 'forward': await c.forward(sid); return textResult('Navigated forward')
      case 'reload':  await c.reload(sid);  return textResult('Page reloaded')
      case 'reset': {
        const r = await c.reset(sid)
        return textResult(`Connection reset. Current URL: ${r.pageUrl}`)
      }
    }
  }),
)

// ── interact: page-state-changing actions ──

server.tool(
  'interact',
  `Interact with the page. The "action" field determines which other fields apply.
Use the @ref labels from \`query({ what: "snapshot" })\` for ref-targeted actions.

  • click / dblclick / hover / focus / check / uncheck — requires ref
  • fill   — requires ref + value
  • type   — requires text (typed into focused element)
  • press  — requires key (e.g. "Enter", "Tab", "Control+a")
  • scroll — optional direction (default "down") + optional amount (px)
  • select — requires ref + value (option value or label)
  • upload — requires ref + files (absolute paths)
  • download — requires ref OR url
  • drag   — requires source + target (both refs)
  • wait   — provide one of: ref / text / url / ms`,
  {
    action: z.enum([
      'click', 'dblclick', 'fill', 'type', 'press', 'hover', 'focus',
      'check', 'uncheck', 'scroll', 'select', 'upload', 'download', 'drag', 'wait',
    ]).describe('Interaction action'),
    ref: z.string().optional().describe('Element @ref from snapshot (e.g. "@e5")'),
    value: z.string().optional().describe('Value for fill / select'),
    text: z.string().optional().describe('Text for type'),
    key: z.string().optional().describe('Key chord for press (e.g. "Enter", "Control+a")'),
    direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('Direction for scroll'),
    amount: z.number().optional().describe('Pixels for scroll'),
    files: z.array(z.string()).optional().describe('Absolute file paths for upload'),
    url: z.string().optional().describe('URL for download (alternative to ref)'),
    source: z.string().optional().describe('Source @ref for drag'),
    target: z.string().optional().describe('Target @ref for drag'),
    ms: z.number().optional().describe('Wait this many milliseconds (wait action)'),
    timeout: z.number().optional().describe('Per-action timeout in ms'),
  },
  toolHandler(async (args) => {
    const sid = await ensureSession()
    const c = getClient()
    const { action } = args

    switch (action) {
      case 'click': {
        const ref = requireField(args.ref, 'ref', action)
        await c.click(sid, ref)
        return textResult(`Clicked ${ref}`)
      }
      case 'dblclick': {
        const ref = requireField(args.ref, 'ref', action)
        await c.dblclick(sid, ref)
        return textResult(`Double-clicked ${ref}`)
      }
      case 'hover': {
        const ref = requireField(args.ref, 'ref', action)
        await c.hover(sid, ref)
        return textResult(`Hovered ${ref}`)
      }
      case 'focus': {
        const ref = requireField(args.ref, 'ref', action)
        await c.focus(sid, ref)
        return textResult(`Focused ${ref}`)
      }
      case 'check': {
        const ref = requireField(args.ref, 'ref', action)
        await c.check(sid, ref)
        return textResult(`Checked ${ref}`)
      }
      case 'uncheck': {
        const ref = requireField(args.ref, 'ref', action)
        await c.uncheck(sid, ref)
        return textResult(`Unchecked ${ref}`)
      }
      case 'fill': {
        const ref = requireField(args.ref, 'ref', action)
        const value = requireField(args.value, 'value', action)
        await c.fill(sid, ref, value)
        return textResult(`Filled ${ref}`)
      }
      case 'type': {
        const text = requireField(args.text, 'text', action)
        await c.type(sid, text)
        return textResult(`Typed "${text}"`)
      }
      case 'press': {
        const key = requireField(args.key, 'key', action)
        await c.press(sid, key)
        return textResult(`Pressed ${key}`)
      }
      case 'scroll': {
        const direction = args.direction ?? 'down'
        await c.scroll(sid, direction, args.amount)
        return textResult(`Scrolled ${direction}${args.amount ? ` ${args.amount}px` : ''}`)
      }
      case 'select': {
        const ref = requireField(args.ref, 'ref', action)
        const value = requireField(args.value, 'value', action)
        await c.selectOption(sid, ref, value)
        return textResult(`Selected "${value}" in ${ref}`)
      }
      case 'upload': {
        const ref = requireField(args.ref, 'ref', action)
        const files = args.files
        if (!files || files.length === 0) throw new Error('files required for action="upload"')
        await c.upload(sid, ref, files)
        return textResult(`Uploaded ${files.length} file(s) to ${ref}`)
      }
      case 'download': {
        if (!args.ref && !args.url) throw new Error('ref or url required for action="download"')
        const r = await c.download(sid, { ref: args.ref, url: args.url, timeout: args.timeout })
        return {
          content: [
            { type: 'text', text: `Downloaded: ${r.suggestedFilename} (${r.totalBytes} bytes)` },
            { type: 'text', text: `Base64 data length: ${r.data.length} chars` },
          ],
        }
      }
      case 'drag': {
        const source = requireField(args.source, 'source', action)
        const target = requireField(args.target, 'target', action)
        await c.drag(sid, source, target)
        return textResult(`Dragged ${source} → ${target}`)
      }
      case 'wait': {
        const opts = {
          ref: args.ref,
          ms: args.ms,
          timeout: args.timeout,
        }
        if (!opts.ref && opts.ms === undefined) {
          throw new Error('wait requires ref or ms')
        }
        await c.waitFor(sid, opts)
        return textResult('Wait completed')
      }
    }
  }),
)

// ── query: read state without side effects ──

server.tool(
  'query',
  `Read state from the page without modifying it. The "what" field selects what to read.

  • snapshot   — accessibility tree with @ref labels (start here to find elements)
  • screenshot — image of the current viewport
  • url        — current page URL
  • title      — current page title
  • text       — text content of an element (requires ref)
  • html       — outer HTML of an element (requires ref)
  • value      — input value (requires ref)
  • visible    — whether element is visible (requires ref)
  • checked    — checkbox/radio state (requires ref)
  • enabled    — whether element is enabled (requires ref)
  • count      — how many elements match a CSS selector (requires selector)`,
  {
    what: z.enum([
      'snapshot', 'screenshot', 'url', 'title',
      'text', 'html', 'value', 'visible', 'checked', 'enabled', 'count',
    ]).describe('What to query'),
    ref: z.string().optional().describe('Element @ref for ref-targeted queries'),
    selector: z.string().optional().describe('CSS selector for what="count"'),
    interactive: z.boolean().optional().describe('snapshot: only interactive elements'),
  },
  toolHandler(async ({ what, ref, selector, interactive }) => {
    const sid = await ensureSession()
    const c = getClient()
    switch (what) {
      case 'snapshot': {
        const r = await c.snapshot(sid, { interactiveOnly: interactive })
        return textResult(r.snapshot)
      }
      case 'screenshot': {
        const r = await c.captureScreenshot(sid)
        return {
          content: [
            { type: 'text', text: 'Screenshot captured.' },
            { type: 'image', data: r.data, mimeType: r.mimeType },
          ],
        }
      }
      case 'url':     return textResult((await c.getUrl(sid)).url)
      case 'title':   return textResult((await c.getTitle(sid)).title)
      case 'text': {
        const r2 = requireField(ref, 'ref', 'text')
        return textResult((await c.getText(sid, r2)).text)
      }
      case 'html': {
        const r2 = requireField(ref, 'ref', 'html')
        return textResult((await c.getHtml(sid, r2)).html)
      }
      case 'value': {
        const r2 = requireField(ref, 'ref', 'value')
        return textResult((await c.getValue(sid, r2)).value)
      }
      case 'visible': {
        const r2 = requireField(ref, 'ref', 'visible')
        return textResult(String((await c.isVisible(sid, r2)).visible))
      }
      case 'checked': {
        const r2 = requireField(ref, 'ref', 'checked')
        return textResult(String((await c.isChecked(sid, r2)).checked))
      }
      case 'enabled': {
        const r2 = requireField(ref, 'ref', 'enabled')
        return textResult(String((await c.isEnabled(sid, r2)).enabled))
      }
      case 'count': {
        const s = requireField(selector, 'selector', 'count')
        return textResult(String((await c.getCount(sid, s)).count))
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
  `Send a raw Chrome DevTools Protocol command. Escape hatch for operations not covered by other tools.

Example:
  cdp({ method: "Page.captureScreenshot", params: { format: "png" } })
  cdp({ method: "Network.enable" })`,
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
