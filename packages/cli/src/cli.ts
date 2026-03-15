#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import { fileURLToPath } from 'node:url'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import pc from 'picocolors'

Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}

import {
  killPortProcess,
  isPortInUse,
  VERSION,
  LOG_FILE_PATH,
  LOG_CDP_FILE_PATH,
  CONFIG_FILE_PATH,
  RELAY_PORT,
  getExtensionOutdatedWarning,
  RelayApiClient,
  readConfig,
  writeConfig,
} from '@agmod/runbrowser-server'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cliRelayEnv = { RUNBROWSER_AUTO_ENABLE: '1' }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClient(argv: { host?: string; token?: string }): RelayApiClient {
  const config = readConfig()
  return new RelayApiClient({
    host: argv.host || process.env.RUNBROWSER_HOST || config.host,
    token: argv.token || process.env.RUNBROWSER_TOKEN || config.token,
    logger: console,
  })
}

/** Auto-session: resolve session from --session, env, or auto-create a default. */
async function resolveSession(argv: { session?: string | number; host?: string; token?: string }): Promise<{ sessionId: string; client: RelayApiClient }> {
  const client = createClient(argv)
  await client.ensureServer(cliRelayEnv)

  // Explicit session
  if (argv.session != null) {
    return { sessionId: String(argv.session), client }
  }
  // Env var
  if (process.env.RUNBROWSER_SESSION) {
    return { sessionId: process.env.RUNBROWSER_SESSION, client }
  }

  // Auto-session: try to reuse existing, or create new
  const sessions = await client.listSessions()
  if (sessions.length > 0) {
    return { sessionId: String(sessions[0].id), client }
  }

  // No sessions — create one
  let extensions = await client.waitForExtensions({ timeoutMs: 12000, pollIntervalMs: 250 })
  if (extensions.length === 0) {
    console.error(pc.dim('Waiting for extension to connect...'))
    extensions = await client.waitForExtensions({ timeoutMs: 10000, pollIntervalMs: 250 })
  }
  if (extensions.length === 0) {
    console.error('No connected browsers. Click the RunBrowser extension icon.')
    process.exit(1)
  }
  const ext = extensions[0]
  const extensionId = ext.extensionId === 'default' ? null : ext.stableKey || ext.extensionId
  const session = await client.createSession({ extensionId, cwd: process.cwd() })
  console.error(pc.dim(`Auto-created session ${session.id}`))
  return { sessionId: String(session.id), client }
}

/** Format output — plain text or JSON */
function output(data: Record<string, unknown>, json?: boolean) {
  if (json) {
    console.log(JSON.stringify(data))
  } else {
    const vals = Object.values(data)
    if (vals.length === 1 && (typeof vals[0] === 'string' || typeof vals[0] === 'boolean')) {
      console.log(vals[0])
    } else {
      console.log(JSON.stringify(data, null, 2))
    }
  }
}

function ok(msg: string, json?: boolean) {
  if (json) output({ success: true }, true)
  else console.log(msg)
}

function die(msg: string): never {
  console.error(`Error: ${msg}`)
  process.exit(1)
}

/** Set a nested config value using dot notation */
function setNestedValue(obj: any, key: string, value: string) {
  const parts = key.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {}
    }
    current = current[parts[i]]
  }
  const last = parts[parts.length - 1]
  if (value === 'true') current[last] = true
  else if (value === 'false') current[last] = false
  else if (/^\d+$/.test(value)) current[last] = parseInt(value, 10)
  else current[last] = value
}

/** Delete a nested config value using dot notation */
function deleteNestedValue(obj: any, key: string) {
  const parts = key.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) return
    current = current[parts[i]]
  }
  delete current[parts[parts.length - 1]]
}

// ---------------------------------------------------------------------------
// Shared option builders
// ---------------------------------------------------------------------------

const globalOpts = {
  host: { type: 'string' as const, describe: 'Relay server host (or RUNBROWSER_HOST)' },
  token: { type: 'string' as const, describe: 'Auth token (or RUNBROWSER_TOKEN)' },
  session: { alias: 's', type: 'string' as const, describe: 'Session ID (auto-created if omitted)' },
  json: { type: 'boolean' as const, describe: 'JSON output', default: false },
} as const

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

await yargs(hideBin(process.argv))
  .scriptName('runbrowser')
  .version(VERSION)
  .strict()
  .demandCommand(1, 'Run `runbrowser --help` to see available commands.')
  .wrap(100)
  .fail((msg, err) => {
    if (err) throw err
    console.error(msg)
    process.exit(1)
  })

  // =========================================================================
  // Navigation (flat — hot path)
  // =========================================================================
  .command(
    ['open <url>', 'goto <url>', 'navigate <url>'],
    'Navigate to a URL',
    (y) => y.options(globalOpts).positional('url', { type: 'string', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try {
        const result = await client.navigate(sessionId, argv.url)
        output({ url: result.url, title: result.title }, argv.json)
      } catch (e: any) { die(e.message) }
    },
  )

  .command('back', 'Go back in history', (y) => y.options(globalOpts), async (argv) => {
    const { sessionId, client } = await resolveSession(argv)
    try { await client.back(sessionId); ok('Navigated back', argv.json) } catch (e: any) { die(e.message) }
  })

  .command('forward', 'Go forward in history', (y) => y.options(globalOpts), async (argv) => {
    const { sessionId, client } = await resolveSession(argv)
    try { await client.forward(sessionId); ok('Navigated forward', argv.json) } catch (e: any) { die(e.message) }
  })

  .command('reload', 'Reload the page', (y) => y.options(globalOpts), async (argv) => {
    const { sessionId, client } = await resolveSession(argv)
    try { await client.reload(sessionId); ok('Reloaded', argv.json) } catch (e: any) { die(e.message) }
  })

  .command(['close', 'quit', 'exit'], 'Close browser session', (y) => y.options(globalOpts), async (argv) => {
    const { sessionId, client } = await resolveSession(argv)
    try { await client.deleteSession(sessionId); ok(`Session ${sessionId} closed`, argv.json) } catch (e: any) { die(e.message) }
  })

  // =========================================================================
  // Observation (flat — hot path)
  // =========================================================================
  .command(
    'snapshot',
    'Accessibility snapshot (element tree with @refs)',
    (y) => y.options(globalOpts)
      .option('interactive', { alias: 'i', type: 'boolean', describe: 'Interactive elements only', default: false })
      .option('compact', { alias: 'c', type: 'boolean', describe: 'Remove empty containers', default: false })
      .option('depth', { alias: 'd', type: 'number', describe: 'Limit tree depth' })
      .option('selector', { alias: 'S', type: 'string', describe: 'Scope to CSS selector' }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try {
        const result = await client.snapshot(sessionId, {
          interactiveOnly: argv.interactive,
          ...(argv.compact && { compact: true }),
          ...(argv.depth && { maxDepth: argv.depth }),
          ...(argv.selector && { selector: argv.selector }),
        })
        if (argv.json) console.log(JSON.stringify(result))
        else console.log(result.snapshot)
      } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'screenshot [path]',
    'Take a screenshot',
    (y) => y.options(globalOpts)
      .positional('path', { type: 'string', describe: 'Save to file' })
      .option('full', { alias: 'f', type: 'boolean', describe: 'Full page screenshot', default: false })
      .option('annotate', { alias: 'a', type: 'boolean', describe: 'Add numbered element labels', default: false }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try {
        const result = await client.captureScreenshot(sessionId)
        if (argv.path) {
          fs.writeFileSync(argv.path, Buffer.from(result.data, 'base64'))
          if (argv.json) output({ path: argv.path, mimeType: result.mimeType }, true)
          else console.log(`Screenshot saved to ${argv.path}`)
        } else {
          if (argv.json) console.log(JSON.stringify(result))
          else console.log(`Screenshot captured (${result.mimeType}, ${result.data.length} base64 chars)`)
        }
      } catch (e: any) { die(e.message) }
    },
  )

  // =========================================================================
  // Interaction (flat — hot path)
  // =========================================================================
  .command(
    'click <ref>',
    'Click an element by @ref',
    (y) => y.options(globalOpts).positional('ref', { type: 'string', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.click(sessionId, argv.ref); ok(`Clicked ${argv.ref}`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'dblclick <ref>',
    'Double-click an element by @ref',
    (y) => y.options(globalOpts).positional('ref', { type: 'string', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.dblclick(sessionId, argv.ref); ok(`Double-clicked ${argv.ref}`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'fill <ref> <value>',
    'Clear and fill an input by @ref',
    (y) => y.options(globalOpts)
      .positional('ref', { type: 'string', demandOption: true })
      .positional('value', { type: 'string', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.fill(sessionId, argv.ref, argv.value); ok(`Filled ${argv.ref}`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'type <text>',
    'Type text at current focus',
    (y) => y.options(globalOpts).positional('text', { type: 'string', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.type(sessionId, argv.text); ok(`Typed "${argv.text}"`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'press <key>',
    'Press a key (Enter, Tab, Escape, ...)',
    (y) => y.options(globalOpts).positional('key', { type: 'string', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.press(sessionId, argv.key); ok(`Pressed ${argv.key}`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'select <ref> <value>',
    'Select a dropdown option by @ref',
    (y) => y.options(globalOpts)
      .positional('ref', { type: 'string', demandOption: true })
      .positional('value', { type: 'string', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.selectOption(sessionId, argv.ref, argv.value); ok(`Selected "${argv.value}" on ${argv.ref}`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'check <ref>',
    'Check a checkbox by @ref',
    (y) => y.options(globalOpts).positional('ref', { type: 'string', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.check(sessionId, argv.ref); ok(`Checked ${argv.ref}`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'uncheck <ref>',
    'Uncheck a checkbox by @ref',
    (y) => y.options(globalOpts).positional('ref', { type: 'string', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.uncheck(sessionId, argv.ref); ok(`Unchecked ${argv.ref}`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'scroll <direction> [amount]',
    'Scroll the page (up/down/left/right)',
    (y) => y.options(globalOpts)
      .positional('direction', { type: 'string', choices: ['up', 'down', 'left', 'right'] as const, demandOption: true })
      .positional('amount', { type: 'number', describe: 'Pixels to scroll' }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.scroll(sessionId, argv.direction, argv.amount); ok(`Scrolled ${argv.direction}${argv.amount ? ` ${argv.amount}px` : ''}`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'hover <ref>',
    'Hover over an element by @ref',
    (y) => y.options(globalOpts).positional('ref', { type: 'string', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.hover(sessionId, argv.ref); ok(`Hovered ${argv.ref}`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'focus <ref>',
    'Focus an element by @ref',
    (y) => y.options(globalOpts).positional('ref', { type: 'string', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.focus(sessionId, argv.ref); ok(`Focused ${argv.ref}`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'upload <ref> <files..>',
    'Upload files to an input by @ref',
    (y) => y.options(globalOpts)
      .positional('ref', { type: 'string', demandOption: true })
      .positional('files', { type: 'string', array: true, demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.upload(sessionId, argv.ref, argv.files); ok(`Uploaded ${argv.files.length} file(s) to ${argv.ref}`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'drag <source> <target>',
    'Drag from source to target element',
    (y) => y.options(globalOpts)
      .positional('source', { type: 'string', demandOption: true })
      .positional('target', { type: 'string', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.drag(sessionId, argv.source, argv.target); ok(`Dragged ${argv.source} → ${argv.target}`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'viewport <width> <height>',
    'Set viewport size',
    (y) => y.options(globalOpts)
      .positional('width', { type: 'number', demandOption: true })
      .positional('height', { type: 'number', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try { await client.viewport(sessionId, argv.width, argv.height); ok(`Viewport set to ${argv.width}×${argv.height}`, argv.json) } catch (e: any) { die(e.message) }
    },
  )

  // =========================================================================
  // Wait (flat — polymorphic)
  // =========================================================================
  .command(
    'wait [target]',
    'Wait for element, time, text, URL, load state, or JS condition',
    (y) => y.options(globalOpts)
      .positional('target', { type: 'string', describe: '@ref or milliseconds' })
      .option('text', { type: 'string', describe: 'Wait for text to appear' })
      .option('url', { type: 'string', describe: 'Wait for URL pattern (** = glob)' })
      .option('load', { type: 'string', describe: 'Wait for load state', choices: ['load', 'domcontentloaded', 'networkidle'] as const })
      .option('fn', { type: 'string', describe: 'Wait for JS expression to be truthy' })
      .option('timeout', { type: 'number', describe: 'Max wait time in ms', default: 10000 }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try {
        const opts: Record<string, unknown> = { timeout: argv.timeout }
        if (argv.text) opts.text = argv.text
        else if (argv.url) opts.url = argv.url
        else if (argv.load) opts.load = argv.load
        else if (argv.fn) opts.fn = argv.fn
        else if (argv.target) {
          const n = Number(argv.target)
          if (!isNaN(n) && !argv.target.startsWith('@')) opts.ms = n
          else opts.ref = argv.target
        } else {
          die('wait requires a target: @ref, ms, --text, --url, --load, or --fn')
        }
        await client.waitFor(sessionId, opts as any)
        ok('Wait completed', argv.json)
      } catch (e: any) { die(e.message) }
    },
  )

  // =========================================================================
  // Escape hatches (flat)
  // =========================================================================
  .command(
    'eval <code>',
    'Run JavaScript in the browser page context',
    (y) => y.options(globalOpts)
      .positional('code', { type: 'string', demandOption: true })
      .option('timeout', { type: 'number', describe: 'Timeout in ms', default: 10000 }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try {
        const result = await client.evaluate(sessionId, argv.code, argv.timeout)
        if (result.text) {
          if (result.isError) { console.error(result.text); process.exit(1) }
          else if (argv.json) output({ value: result.text }, true)
          else console.log(result.text)
        }
      } catch (e: any) { die(e.message) }
    },
  )

  .command(
    'cdp <method> [params]',
    'Send a raw CDP command (Chrome DevTools Protocol)',
    (y) => y.options(globalOpts)
      .positional('method', { type: 'string', demandOption: true, describe: 'CDP method (e.g. Page.captureScreenshot)' })
      .positional('params', { type: 'string', describe: 'JSON params' }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try {
        const params = argv.params ? JSON.parse(argv.params) : undefined
        const result = await client.cdp(sessionId, argv.method, params)
        console.log(JSON.stringify(result.result, null, 2))
      } catch (e: any) {
        if (e instanceof SyntaxError) die(`Invalid JSON params: ${e.message}`)
        die(e.message)
      }
    },
  )

  // =========================================================================
  // get: query info from elements or page (subgroup)
  // =========================================================================
  .command(
    'get <what> [ref]',
    'Get info: text, html, value, attr, url, title, count',
    (y) => y.options(globalOpts)
      .positional('what', { type: 'string', choices: ['text', 'html', 'value', 'attr', 'url', 'title', 'count'] as const, demandOption: true })
      .positional('ref', { type: 'string', describe: '@ref from snapshot' })
      .option('attr-name', { type: 'string', describe: 'Attribute name (for `get attr`)' }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try {
        switch (argv.what) {
          case 'url': {
            const r = await client.getUrl(sessionId)
            output({ url: r.url }, argv.json)
            break
          }
          case 'title': {
            const r = await client.getTitle(sessionId)
            output({ title: r.title }, argv.json)
            break
          }
          case 'text': {
            if (!argv.ref) die('ref is required for `get text`')
            const r = await client.getText(sessionId, argv.ref!)
            output({ text: r.text }, argv.json)
            break
          }
          case 'html': {
            if (!argv.ref) die('ref is required for `get html`')
            const r = await client.getHtml(sessionId, argv.ref!)
            output({ html: r.html }, argv.json)
            break
          }
          case 'value': {
            if (!argv.ref) die('ref is required for `get value`')
            const r = await client.getValue(sessionId, argv.ref!)
            output({ value: r.value }, argv.json)
            break
          }
          case 'attr': {
            if (!argv.ref) die('ref is required for `get attr`')
            const attrName = argv.attrName
            if (!attrName) die('--attr-name is required for `get attr`')
            const r = await client.getAttribute(sessionId, argv.ref!, attrName!)
            output({ value: r.value }, argv.json)
            break
          }
          case 'count': {
            if (!argv.ref) die('selector is required for `get count`')
            const r = await client.getCount(sessionId, argv.ref!)
            output({ count: r.count }, argv.json)
            break
          }
        }
      } catch (e: any) { die(e.message) }
    },
  )

  // =========================================================================
  // is: check element state (subgroup)
  // =========================================================================
  .command(
    'is <check> <ref>',
    'Check element state: visible, checked, enabled',
    (y) => y.options(globalOpts)
      .positional('check', { type: 'string', choices: ['visible', 'checked', 'enabled'] as const, demandOption: true })
      .positional('ref', { type: 'string', demandOption: true }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try {
        if (argv.check === 'visible') {
          const r = await client.isVisible(sessionId, argv.ref)
          output({ visible: r.visible }, argv.json)
        } else if (argv.check === 'checked') {
          const r = await client.isChecked(sessionId, argv.ref)
          output({ checked: r.checked }, argv.json)
        } else {
          const r = await client.isEnabled(sessionId, argv.ref)
          output({ enabled: r.enabled }, argv.json)
        }
      } catch (e: any) { die(e.message) }
    },
  )

  // =========================================================================
  // find: semantic locators with chained action (subgroup)
  // =========================================================================
  .command(
    'find <by> <value> <action> [actionValue]',
    'Find element by semantic locator and act: role, text, label, placeholder, testid',
    (y) => y.options(globalOpts)
      .positional('by', { type: 'string', choices: ['role', 'text', 'label', 'placeholder', 'testid', 'first', 'nth'] as const, demandOption: true })
      .positional('value', { type: 'string', demandOption: true, describe: 'Locator value (role name, text, label, etc.)' })
      .positional('action', { type: 'string', choices: ['click', 'fill', 'type', 'hover', 'focus', 'check', 'uncheck', 'text'] as const, demandOption: true })
      .positional('actionValue', { type: 'string', describe: 'Value for fill/type actions' })
      .option('name', { type: 'string', describe: 'Filter by accessible name (for role)' })
      .option('exact', { type: 'boolean', describe: 'Require exact text match', default: false })
      .option('index', { alias: 'n', type: 'number', describe: 'Nth match index (for nth)' }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try {
        const result = await client.findAndAct(sessionId, {
          by: argv.by,
          value: argv.value,
          action: argv.action,
          actionValue: argv.actionValue,
          name: argv.name,
          exact: argv.exact,
          index: argv.index,
        })
        if (argv.action === 'text') {
          output({ text: result as string }, argv.json)
        } else {
          ok(`${argv.action} on ${argv.by}="${argv.value}"`, argv.json)
        }
      } catch (e: any) { die(e.message) }
    },
  )

  // =========================================================================
  // tab: manage real browser tabs (subgroup)
  // =========================================================================
  .command(
    'tab [command] [arg]',
    'Manage browser tabs: list, new, switch, close',
    (y) => y.options(globalOpts)
      .positional('command', { type: 'string', describe: 'list (default), new, close, or tab index to switch' })
      .positional('arg', { type: 'string', describe: 'URL for new, or index for close' }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try {
        const cmd = argv.command || 'list'

        // If command is a number, treat as tab switch
        const idx = Number(cmd)
        if (!isNaN(idx)) {
          await client.switchTab(sessionId, idx)
          ok(`Switched to tab ${idx}`, argv.json)
          return
        }

        switch (cmd) {
          case 'list': {
            const r = await client.listTabs(sessionId)
            if (argv.json) console.log(JSON.stringify(r))
            else {
              for (const tab of r.tabs) {
                const marker = tab.active ? pc.green('→') : ' '
                console.log(`${marker} [${tab.index}] ${tab.title || '(untitled)'} — ${tab.url}`)
              }
            }
            break
          }
          case 'new': {
            const r = await client.newTab(sessionId, argv.arg)
            if (argv.json) output({ index: r.index }, true)
            else console.log(`Opened tab ${r.index}${argv.arg ? ` at ${argv.arg}` : ''}`)
            break
          }
          case 'close': {
            const closeIdx = argv.arg ? Number(argv.arg) : undefined
            await client.closeTab(sessionId, closeIdx)
            ok(`Closed tab${closeIdx != null ? ` ${closeIdx}` : ''}`, argv.json)
            break
          }
          default:
            die(`Unknown tab command: ${cmd}. Use: list, new, close, or <index>`)
        }
      } catch (e: any) { die(e.message) }
    },
  )

  // =========================================================================
  // frame: iframe navigation (subgroup)
  // =========================================================================
  .command(
    'frame <selector>',
    'Switch to an iframe (use "main" to return to main frame)',
    (y) => y.options(globalOpts)
      .positional('selector', { type: 'string', demandOption: true, describe: 'CSS selector or "main"' }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try {
        if (argv.selector === 'main') {
          await client.switchToMainFrame(sessionId)
          ok('Switched to main frame', argv.json)
        } else {
          await client.switchFrame(sessionId, argv.selector)
          ok(`Switched to frame ${argv.selector}`, argv.json)
        }
      } catch (e: any) { die(e.message) }
    },
  )

  // =========================================================================
  // diff: compare states (subgroup)
  // =========================================================================
  .command(
    'diff <type>',
    'Compare states: snapshot, screenshot',
    (y) => y.options(globalOpts)
      .positional('type', { type: 'string', choices: ['snapshot', 'screenshot'] as const, demandOption: true })
      .option('baseline', { alias: 'b', type: 'string', describe: 'Baseline file to compare against' })
      .option('output', { alias: 'o', type: 'string', describe: 'Output file for diff (screenshot only)' }),
    async (argv) => {
      const { sessionId, client } = await resolveSession(argv)
      try {
        if (argv.type === 'snapshot') {
          const r = await client.diffSnapshot(sessionId, argv.baseline)
          if (argv.json) console.log(JSON.stringify(r))
          else console.log(r.diff)
        } else {
          if (!argv.baseline) die('--baseline is required for screenshot diff')
          const r = await client.diffScreenshot(sessionId, argv.baseline!, argv.output)
          if (argv.json) console.log(JSON.stringify(r))
          else console.log(`Diff saved to ${r.path}`)
        }
      } catch (e: any) { die(e.message) }
    },
  )

  // =========================================================================
  // session: manage sessions (subgroup — was session-*)
  // =========================================================================
  .command(
    'session <command> [id]',
    'Manage sessions: new, list, delete',
    (y) => y.options(globalOpts)
      .positional('command', { type: 'string', choices: ['new', 'list', 'delete'] as const, demandOption: true })
      .positional('id', { type: 'string', describe: 'Session ID (for delete)' })
      .option('browser', { type: 'string', describe: 'Browser stable key (for new)' }),
    async (argv) => {
      const client = createClient(argv)

      switch (argv.command) {
        case 'new': {
          await client.ensureServer(cliRelayEnv)
          let extensions = await client.waitForExtensions({ timeoutMs: 12000, pollIntervalMs: 250 })
          if (extensions.length === 0) {
            console.error(pc.dim('Waiting for extension...'))
            extensions = await client.waitForExtensions({ timeoutMs: 10000, pollIntervalMs: 250 })
          }
          if (extensions.length === 0) die('No connected browsers. Click the RunBrowser extension icon.')

          let ext = extensions[0]
          if (extensions.length > 1) {
            if (!argv.browser) {
              console.log('Multiple browsers detected:\n')
              console.log('KEY                      BROWSER  PROFILE')
              console.log('-----------------------  -------  -------')
              for (const e of extensions) {
                console.log(`${(e.stableKey || '-').padEnd(23)}  ${(e.browser || 'Chrome').padEnd(7)}  ${e.profile?.email || '(not signed in)'}`)
              }
              console.log('\nRun again with --browser <key>.')
              process.exit(1)
            }
            ext = extensions.find((e) => e.stableKey === argv.browser)!
            if (!ext) die(`Browser not found: ${argv.browser}`)
          }

          const extensionId = ext.extensionId === 'default' ? null : ext.stableKey || ext.extensionId
          const session = await client.createSession({ extensionId, cwd: process.cwd() })
          if (argv.json) output({ id: session.id }, true)
          else console.log(`Session ${session.id} created.`)
          break
        }

        case 'list': {
          await client.ensureServer(cliRelayEnv)
          try {
            const sessions = await client.listSessions()
            if (argv.json) { console.log(JSON.stringify(sessions)); return }
            if (sessions.length === 0) { console.log('No active sessions'); return }
            const idW = Math.max(2, ...sessions.map((s) => String(s.id).length))
            const brW = Math.max(7, ...sessions.map((s) => (s.browser || 'Chrome').length))
            const prW = Math.max(7, ...sessions.map((s) => (s.profile?.email || '').length || 1))
            console.log('ID'.padEnd(idW) + '  ' + 'BROWSER'.padEnd(brW) + '  ' + 'PROFILE'.padEnd(prW) + '  STATE KEYS')
            console.log('-'.repeat(idW + brW + prW + 20))
            for (const s of sessions) {
              console.log(String(s.id).padEnd(idW) + '  ' + (s.browser || 'Chrome').padEnd(brW) + '  ' + (s.profile?.email || '-').padEnd(prW) + '  ' + (s.stateKeys.length > 0 ? s.stateKeys.join(', ') : '-'))
            }
          } catch (e: any) { die(e.message) }
          break
        }

        case 'delete': {
          if (!argv.id) die('Session ID required: session delete <id>')
          await client.ensureServer(cliRelayEnv)
          try { await client.deleteSession(argv.id); console.log(`Session ${argv.id} deleted.`) } catch (e: any) { die(e.message) }
          break
        }
      }
    },
  )


  // =========================================================================
  // config: persistent settings (subgroup — was config-*)
  // =========================================================================
  .command(
    'config <command> [key] [value]',
    'Manage config: set, unset, show',
    (y) => y
      .positional('command', { type: 'string', choices: ['set', 'unset', 'show'] as const, demandOption: true })
      .positional('key', { type: 'string', describe: 'Config key (dot notation)' })
      .positional('value', { type: 'string', describe: 'Config value' }),
    (argv) => {
      switch (argv.command) {
        case 'set': {
          if (!argv.key || !argv.value) die('Usage: config set <key> <value>')
          const config = readConfig()
          setNestedValue(config, argv.key, argv.value)
          writeConfig(config)
          console.log(`${argv.key} = ${argv.key.includes('token') ? '***' : argv.value}`)
          break
        }

        case 'unset': {
          if (!argv.key) die('Usage: config unset <key>')
          const config = readConfig()
          deleteNestedValue(config, argv.key)
          writeConfig(config)
          console.log(`Removed ${argv.key}`)
          break
        }

        case 'show': {
          const config = readConfig()
          console.log(`Config: ${CONFIG_FILE_PATH}`)
          if (Object.keys(config).length === 0) { console.log('(empty)'); return }
          if (config.host) console.log(`  host:  ${config.host}`)
          if (config.token) console.log(`  token: ${'*'.repeat(config.token.length)}`)
          if (config.credentials) {
            console.log('  credentials:')
            console.log(`    vault:     ${config.credentials.vault || 'none'}`)
            if (config.credentials.vaultPath) console.log(`    vaultPath: ${config.credentials.vaultPath}`)
            if (config.credentials.policy) {
              const p = config.credentials.policy
              if (p.allowedDomains) console.log(`    allowedDomains: ${p.allowedDomains.join(', ')}`)
              if (p.approvalRequired?.length) console.log(`    approvalRequired: ${p.approvalRequired.join(', ')}`)
            }
            console.log(`    auditLog:  ${config.credentials.auditLog !== false}`)
          }
          break
        }
      }
    },
  )

  // =========================================================================
  // Server & utilities
  // =========================================================================
  .command(
    'serve',
    'Start the relay server (run on same host as Chrome)',
    (y) => y
      .option('host', { type: 'string', describe: 'Bind host (0.0.0.0 for remote)', default: '127.0.0.1' })
      .option('token', { type: 'string', describe: 'Auth token (required for 0.0.0.0)' })
      .option('replace', { type: 'boolean', describe: 'Kill existing server' }),
    async (argv) => {
      const token = argv.token || process.env.RUNBROWSER_TOKEN
      if ((argv.host === '0.0.0.0' || argv.host === '::') && !token) {
        die('Auth token required for public host. Use --token or RUNBROWSER_TOKEN.')
      }
      const portInUse = await isPortInUse(RELAY_PORT)
      if (portInUse) {
        if (!argv.replace) { console.log(`Server already running on port ${RELAY_PORT}. Use --replace to restart.`); process.exit(0) }
        console.log(`Killing existing server on port ${RELAY_PORT}...`)
        await killPortProcess({ port: RELAY_PORT })
      }
      const { createFileLogger, startRunBrowserCDPRelayServer } = await import('@agmod/runbrowser-server')
      const logger = createFileLogger()
      process.title = 'runbrowser-serve'
      process.on('uncaughtException', async (err) => { await logger.error('Uncaught:', err); process.exit(1) })
      process.on('unhandledRejection', async (reason) => { await logger.error('Unhandled:', reason); process.exit(1) })
      const server = await startRunBrowserCDPRelayServer({ port: RELAY_PORT, host: argv.host, token, logger })
      console.log(`RunBrowser relay server started on ${argv.host}:${RELAY_PORT}`)
      console.log(`Logs: ${logger.logFilePath}`)
      const shutdown = () => { console.log('\nShutting down...'); server.close(); process.exit(0) }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    },
  )

  .command('logfile', 'Print log file paths', {}, () => {
    console.log(`relay: ${LOG_FILE_PATH}`)
    console.log(`cdp:   ${LOG_CDP_FILE_PATH}`)
  })

  .command('skill', 'Print full usage instructions', {}, () => {
    const p = path.join(__dirname, '..', 'src', 'skill.md')
    console.log(fs.readFileSync(p, 'utf-8'))
  })

  .parseAsync()
