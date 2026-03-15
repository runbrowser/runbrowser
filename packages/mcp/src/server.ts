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
// Helper
// ============================================================================

function toolHandler<T extends Record<string, unknown>>(
  fn: (args: T) => Promise<{ content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>; isError?: boolean }>,
): (args: T) => Promise<{ content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>; isError?: boolean }> {
  return async (args) => {
    try {
      return await fn(args)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('404')) sessionId = null
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
    }
  }
}

// ============================================================================
// MCP Server — Two Tools: skill + run
// ============================================================================

const server = new McpServer({
  name: 'runbrowser',
  title: 'Control your running Chrome browser — your logins, extensions, cookies already there.',
  version: VERSION,
})

// ── skill: discover available commands and CLI usage ──

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadSkillContent(): string {
  // Try multiple paths (src vs dist)
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
  `Show RunBrowser CLI usage, available commands, and site commands.
Call this first to learn how to control the browser and what site commands are available.
Returns full documentation including command syntax, examples, and options.`,
  {},
  toolHandler(async () => {
    let content = loadSkillContent()

    // Append site commands from relay if available
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
          return `runbrowser ${cmd.site} ${cmd.name}${argStr}  # ${cmd.description}`
        }).join('\n')
      }
    } catch {
      // Relay not running — just return static skill content
    }

    return { content: [{ type: 'text', text: content }] }
  }),
)

// ── run: execute any runbrowser command ──

server.tool(
  'run',
  `Execute a RunBrowser CLI command. Translates to the equivalent of running \`runbrowser <command>\` in a terminal.

Use the \`skill\` tool first to discover available commands and their syntax.

Examples:
  run({ command: "navigate https://github.com" })
  run({ command: "snapshot" })
  run({ command: "click @e1" })
  run({ command: "eval document.title" })
  run({ command: "github trending --limit 5" })

The command string follows the same syntax as the CLI. Output is returned as JSON when possible.`,
  {
    command: z.string().describe('The runbrowser command to execute (e.g. "navigate https://example.com", "snapshot", "click @e1", "github trending --limit 5")'),
  },
  toolHandler(async ({ command }) => {
    const sid = await ensureSession()
    const c = getClient()

    // Parse the command string into parts
    const parts = parseCommandString(command)
    if (parts.length === 0) {
      return { content: [{ type: 'text', text: 'Error: empty command' }], isError: true }
    }

    const cmd = parts[0]
    const rest = parts.slice(1)

    // ── Built-in browser commands ──
    switch (cmd) {
      case 'navigate':
      case 'open':
      case 'goto': {
        const url = rest[0]
        if (!url) return { content: [{ type: 'text', text: 'Error: URL required' }], isError: true }
        const result = await c.navigate(sid, url)
        return { content: [{ type: 'text', text: `Navigated to ${result.url}\nTitle: ${result.title}` }] }
      }

      case 'snapshot': {
        const interactiveOnly = rest.includes('--interactive') || rest.includes('-i')
        const result = await c.snapshot(sid, { interactiveOnly })
        return { content: [{ type: 'text', text: result.snapshot }] }
      }

      case 'screenshot': {
        const result = await c.captureScreenshot(sid)
        return {
          content: [
            { type: 'text', text: 'Screenshot captured.' },
            { type: 'image', data: result.data, mimeType: result.mimeType },
          ],
        }
      }

      case 'click': {
        const ref = rest[0]
        if (!ref) return { content: [{ type: 'text', text: 'Error: ref required' }], isError: true }
        await c.click(sid, ref)
        return { content: [{ type: 'text', text: `Clicked ${ref}` }] }
      }

      case 'fill': {
        const ref = rest[0]
        const value = rest.slice(1).join(' ')
        if (!ref || !value) return { content: [{ type: 'text', text: 'Error: ref and value required' }], isError: true }
        await c.fill(sid, ref, value)
        return { content: [{ type: 'text', text: `Filled ${ref} with "${value}"` }] }
      }

      case 'type': {
        const text = rest.join(' ')
        if (!text) return { content: [{ type: 'text', text: 'Error: text required' }], isError: true }
        await c.type(sid, text)
        return { content: [{ type: 'text', text: `Typed "${text}"` }] }
      }

      case 'press': {
        const key = rest[0]
        if (!key) return { content: [{ type: 'text', text: 'Error: key required' }], isError: true }
        await c.press(sid, key)
        return { content: [{ type: 'text', text: `Pressed ${key}` }] }
      }

      case 'scroll': {
        const direction = (rest[0] || 'down') as 'up' | 'down' | 'left' | 'right'
        const amount = rest[1] ? Number(rest[1]) : undefined
        await c.scroll(sid, direction, amount)
        return { content: [{ type: 'text', text: `Scrolled ${direction}${amount ? ` by ${amount}px` : ''}` }] }
      }

      case 'hover': {
        const ref = rest[0]
        if (!ref) return { content: [{ type: 'text', text: 'Error: ref required' }], isError: true }
        await c.hover(sid, ref)
        return { content: [{ type: 'text', text: `Hovered over ${ref}` }] }
      }

      case 'eval':
      case 'evaluate': {
        const code = rest.join(' ')
        if (!code) return { content: [{ type: 'text', text: 'Error: code required' }], isError: true }
        const result = await c.evaluate(sid, code)
        const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
          { type: 'text', text: result.text },
        ]
        for (const img of result.images) {
          content.push({ type: 'image', data: img.data, mimeType: img.mimeType })
        }
        return { content, isError: result.isError }
      }

      case 'back': {
        await c.back(sid)
        return { content: [{ type: 'text', text: 'Navigated back' }] }
      }

      case 'forward': {
        await c.forward(sid)
        return { content: [{ type: 'text', text: 'Navigated forward' }] }
      }

      case 'reload': {
        await c.reload(sid)
        return { content: [{ type: 'text', text: 'Page reloaded' }] }
      }

      case 'reset': {
        const result = await c.reset(sid)
        return { content: [{ type: 'text', text: `Connection reset. Current URL: ${result.pageUrl}` }] }
      }

      case 'get': {
        const what = rest[0]
        if (what === 'url') {
          const result = await c.getUrl(sid)
          return { content: [{ type: 'text', text: result.url }] }
        }
        if (what === 'title') {
          const result = await c.getTitle(sid)
          return { content: [{ type: 'text', text: result.title }] }
        }
        return { content: [{ type: 'text', text: `Error: unknown get target: ${what}` }], isError: true }
      }

      case 'wait': {
        const target = rest[0]
        if (!target) return { content: [{ type: 'text', text: 'Error: wait target required' }], isError: true }
        const n = Number(target)
        if (!isNaN(n) && !target.startsWith('@')) {
          await c.waitFor(sid, { ms: n })
        } else {
          await c.waitFor(sid, { ref: target })
        }
        return { content: [{ type: 'text', text: 'Wait completed' }] }
      }

      default: {
        // ── Site command: `<site> <name> [--args]` ──
        const subcommand = rest[0]
        if (subcommand) {
          const args = parseFlags(rest.slice(1))
          const result = await c.runCommand(sid, cmd, subcommand, args)
          return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] }
        }

        return { content: [{ type: 'text', text: `Unknown command: ${cmd}. Use the skill tool to see available commands.` }], isError: true }
      }
    }
  }),
)

// ============================================================================
// Helpers
// ============================================================================

/** Parse a command string into parts, respecting quotes */
function parseCommandString(input: string): string[] {
  const parts: string[] = []
  let current = ''
  let inQuote: string | null = null

  for (const ch of input) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null
      } else {
        current += ch
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch
    } else if (ch === ' ') {
      if (current) {
        parts.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current) parts.push(current)
  return parts
}

/** Parse --flag value pairs into a record */
function parseFlags(parts: string[]): Record<string, any> {
  const flags: Record<string, any> = {}
  let i = 0
  while (i < parts.length) {
    if (parts[i].startsWith('--')) {
      const key = parts[i].slice(2)
      const next = parts[i + 1]
      if (next && !next.startsWith('--')) {
        const n = Number(next)
        flags[key] = isNaN(n) ? next : n
        i += 2
      } else {
        flags[key] = true
        i++
      }
    } else {
      i++
    }
  }
  return flags
}

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
