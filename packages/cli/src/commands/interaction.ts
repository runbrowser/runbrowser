/**
 * Interaction commands: click, dblclick, fill, type, press, select,
 * check, uncheck, scroll, hover, focus, upload, drag, viewport, wait, find, tab, frame
 */

import pc from 'picocolors'
import { registerBuiltinCommand, type SessionResolver } from './index.js'
import type { ParsedArgs } from '../args.js'
import { output, ok } from '../output.js'

// ============================================================================
// click
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'click',
    description: 'Click an element by @ref',
    positionals: [{ name: 'ref', description: '@ref from snapshot', required: true }],
  },
  async execute(args, resolveSession) {
    const ref = args.subcommand
    if (!ref) throw new Error('Usage: runbrowser click <ref>')
    const { sessionId, client } = await resolveSession(args)
    await client.click(sessionId, ref); ok(`Clicked ${ref}`, args.json)
  },
})

// ============================================================================
// dblclick
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'dblclick',
    description: 'Double-click an element by @ref',
    positionals: [{ name: 'ref', description: '@ref from snapshot', required: true }],
  },
  async execute(args, resolveSession) {
    const ref = args.subcommand
    if (!ref) throw new Error('Usage: runbrowser dblclick <ref>')
    const { sessionId, client } = await resolveSession(args)
    await client.dblclick(sessionId, ref); ok(`Double-clicked ${ref}`, args.json)
  },
})

// ============================================================================
// fill
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'fill',
    description: 'Clear and fill an input by @ref',
    positionals: [
      { name: 'ref', description: '@ref from snapshot', required: true },
      { name: 'value', description: 'Value to fill in', required: true },
    ],
  },
  async execute(args, resolveSession) {
    const ref = args.subcommand
    const value = args.positionals[0]
    if (!ref || !value) throw new Error('Usage: runbrowser fill <ref> <value>')
    const { sessionId, client } = await resolveSession(args)
    await client.fill(sessionId, ref, value); ok(`Filled ${ref}`, args.json)
  },
})

// ============================================================================
// type
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'type',
    description: 'Type text at current focus',
    positionals: [{ name: 'text', description: 'Text to type', required: true }],
  },
  async execute(args, resolveSession) {
    const text = args.subcommand
    if (!text) throw new Error('Usage: runbrowser type <text>')
    const { sessionId, client } = await resolveSession(args)
    await client.type(sessionId, text); ok(`Typed "${text}"`, args.json)
  },
})

// ============================================================================
// press
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'press',
    description: 'Press a key (Enter, Tab, Escape, ...)',
    positionals: [{ name: 'key', description: 'Key name', required: true }],
  },
  async execute(args, resolveSession) {
    const key = args.subcommand
    if (!key) throw new Error('Usage: runbrowser press <key>')
    const { sessionId, client } = await resolveSession(args)
    await client.press(sessionId, key); ok(`Pressed ${key}`, args.json)
  },
})

// ============================================================================
// select
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'select',
    description: 'Select a dropdown option by @ref',
    positionals: [
      { name: 'ref', description: '@ref from snapshot', required: true },
      { name: 'value', description: 'Option value', required: true },
    ],
  },
  async execute(args, resolveSession) {
    const ref = args.subcommand
    const value = args.positionals[0]
    if (!ref || !value) throw new Error('Usage: runbrowser select <ref> <value>')
    const { sessionId, client } = await resolveSession(args)
    await client.selectOption(sessionId, ref, value); ok(`Selected "${value}" on ${ref}`, args.json)
  },
})

// ============================================================================
// check / uncheck
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'check',
    description: 'Check a checkbox by @ref',
    positionals: [{ name: 'ref', description: '@ref from snapshot', required: true }],
  },
  async execute(args, resolveSession) {
    const ref = args.subcommand
    if (!ref) throw new Error('Usage: runbrowser check <ref>')
    const { sessionId, client } = await resolveSession(args)
    await client.check(sessionId, ref); ok(`Checked ${ref}`, args.json)
  },
})

registerBuiltinCommand({
  def: {
    name: 'uncheck',
    description: 'Uncheck a checkbox by @ref',
    positionals: [{ name: 'ref', description: '@ref from snapshot', required: true }],
  },
  async execute(args, resolveSession) {
    const ref = args.subcommand
    if (!ref) throw new Error('Usage: runbrowser uncheck <ref>')
    const { sessionId, client } = await resolveSession(args)
    await client.uncheck(sessionId, ref); ok(`Unchecked ${ref}`, args.json)
  },
})

// ============================================================================
// scroll
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'scroll',
    description: 'Scroll the page (up/down/left/right)',
    positionals: [
      { name: 'direction', description: 'up, down, left, right', required: true },
      { name: 'amount', description: 'Pixels to scroll' },
    ],
  },
  async execute(args, resolveSession) {
    const direction = args.subcommand as 'up' | 'down' | 'left' | 'right'
    const amount = args.positionals[0] ? Number(args.positionals[0]) : undefined
    if (!direction) throw new Error('Usage: runbrowser scroll <up|down|left|right> [amount]')
    const { sessionId, client } = await resolveSession(args)
      await client.scroll(sessionId, direction, amount)
      ok(`Scrolled ${direction}${amount ? ` ${amount}px` : ''}`, args.json)
  },
})

// ============================================================================
// hover
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'hover',
    description: 'Hover over an element by @ref',
    positionals: [{ name: 'ref', description: '@ref from snapshot', required: true }],
  },
  async execute(args, resolveSession) {
    const ref = args.subcommand
    if (!ref) throw new Error('Usage: runbrowser hover <ref>')
    const { sessionId, client } = await resolveSession(args)
    await client.hover(sessionId, ref); ok(`Hovered ${ref}`, args.json)
  },
})

// ============================================================================
// focus
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'focus',
    description: 'Focus an element by @ref',
    positionals: [{ name: 'ref', description: '@ref from snapshot', required: true }],
  },
  async execute(args, resolveSession) {
    const ref = args.subcommand
    if (!ref) throw new Error('Usage: runbrowser focus <ref>')
    const { sessionId, client } = await resolveSession(args)
    await client.focus(sessionId, ref); ok(`Focused ${ref}`, args.json)
  },
})

// ============================================================================
// upload
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'upload',
    description: 'Upload files to an input by @ref',
    positionals: [
      { name: 'ref', description: '@ref from snapshot', required: true },
      { name: 'files', description: 'File paths to upload', required: true, variadic: true },
    ],
  },
  async execute(args, resolveSession) {
    const ref = args.subcommand
    const files = args.positionals
    if (!ref || files.length === 0) throw new Error('Usage: runbrowser upload <ref> <files..>')
    const { sessionId, client } = await resolveSession(args)
    await client.upload(sessionId, ref, files); ok(`Uploaded ${files.length} file(s) to ${ref}`, args.json)
  },
})

// ============================================================================
// download
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'download',
    description: 'Download a file by clicking a @ref or from a URL',
    positionals: [
      { name: 'target', description: '@ref to click or URL to download' },
    ],
    flags: {
      output:  { type: 'string',  alias: 'o', description: 'Output file path (default: current directory)', required: true },
      timeout: { type: 'number',  alias: 't', description: 'Max wait time in ms', default: 30000 },
    },
  },
  async execute(args, resolveSession) {
    const target = args.subcommand
    const outputPath = args.flags.get('output') as string
    const timeout = (args.flags.get('timeout') as number) ?? 30000

    if (!target) throw new Error('Usage: runbrowser download <@ref|url> -o <output>')
    if (!outputPath) throw new Error('Output path required: -o <path>')

    const isUrl = target.startsWith('http://') || target.startsWith('https://')
    const options = isUrl
      ? { url: target, timeout }
      : { ref: target, timeout }

    const { sessionId, client } = await resolveSession(args)
    const result = await client.downloadToFile(sessionId, outputPath, options)
    ok(`Downloaded ${result.filename} (${result.size} bytes) → ${result.path}`, args.json)
  },
})

// ============================================================================
// drag
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'drag',
    description: 'Drag from source to target element',
    positionals: [
      { name: 'source', description: 'Source @ref', required: true },
      { name: 'target', description: 'Target @ref', required: true },
    ],
  },
  async execute(args, resolveSession) {
    const source = args.subcommand
    const target = args.positionals[0]
    if (!source || !target) throw new Error('Usage: runbrowser drag <source> <target>')
    const { sessionId, client } = await resolveSession(args)
    await client.drag(sessionId, source, target); ok(`Dragged ${source} → ${target}`, args.json)
  },
})

// ============================================================================
// viewport
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'viewport',
    description: 'Set viewport size',
    positionals: [
      { name: 'width', description: 'Width in pixels', required: true },
      { name: 'height', description: 'Height in pixels', required: true },
    ],
  },
  async execute(args, resolveSession) {
    const width = Number(args.subcommand)
    const height = Number(args.positionals[0])
    if (isNaN(width) || isNaN(height)) throw new Error('Usage: runbrowser viewport <width> <height>')
    const { sessionId, client } = await resolveSession(args)
    await client.viewport(sessionId, width, height); ok(`Viewport set to ${width}×${height}`, args.json)
  },
})

// ============================================================================
// wait
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'wait',
    description: 'Wait for element, time, text, URL, load state, or JS condition',
    positionals: [
      { name: 'target', description: '@ref or milliseconds' },
    ],
    flags: {
      text:    { type: 'string', description: 'Wait for text to appear' },
      url:     { type: 'string', description: 'Wait for URL pattern' },
      load:    { type: 'string', description: 'Wait for load state', choices: ['load', 'domcontentloaded', 'networkidle'] },
      fn:      { type: 'string', description: 'Wait for JS expression to be truthy' },
      timeout: { type: 'number', description: 'Max wait time in ms', default: 10000 },
    },
  },
  async execute(args, resolveSession) {
    const { sessionId, client } = await resolveSession(args)
      const timeout = (args.flags.get('timeout') as number) ?? 10000
      const opts: Record<string, unknown> = { timeout }

      const text = args.flags.get('text') as string | undefined
      const url = args.flags.get('url') as string | undefined
      const load = args.flags.get('load') as string | undefined
      const fn = args.flags.get('fn') as string | undefined
      const target = args.subcommand

      if (text) opts.text = text
      else if (url) opts.url = url
      else if (load) opts.load = load
      else if (fn) opts.fn = fn
      else if (target) {
        const n = Number(target)
        if (!isNaN(n) && !target.startsWith('@')) opts.ms = n
        else opts.ref = target
      } else {
        throw new Error('wait requires: @ref, ms, --text, --url, --load, or --fn')
      }

      await client.waitFor(sessionId, opts as any)
      ok('Wait completed', args.json)
  },
})

// ============================================================================
// find
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'find',
    description: 'Find element by semantic locator and act',
    positionals: [
      { name: 'by', description: 'role, text, label, placeholder, testid', required: true },
      { name: 'value', description: 'Locator value', required: true },
      { name: 'action', description: 'click, fill, type, hover, focus, check, uncheck, text', required: true },
      { name: 'actionValue', description: 'Value for fill/type actions' },
    ],
    flags: {
      name:  { type: 'string',  description: 'Filter by accessible name (for role)' },
      exact: { type: 'boolean', description: 'Require exact text match' },
      index: { type: 'number',  alias: 'n', description: 'Nth match index' },
    },
  },
  async execute(args, resolveSession) {
    const by = args.subcommand
    const value = args.positionals[0]
    const action = args.positionals[1]
    const actionValue = args.positionals[2]
    if (!by || !value || !action) throw new Error('Usage: runbrowser find <by> <value> <action> [actionValue]')

    const { sessionId, client } = await resolveSession(args)
      const result = await client.findAndAct(sessionId, {
        by, value, action, actionValue,
        name: args.flags.get('name') as string,
        exact: args.flags.get('exact') as boolean,
        index: args.flags.get('index') as number,
      })
      if (action === 'text') output({ text: result as string }, args.json)
      else ok(`${action} on ${by}="${value}"`, args.json)
  },
})

// ============================================================================
// tab
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'tab',
    description: 'Manage browser tabs: list, new, switch, close',
    positionals: [
      { name: 'command', description: 'list (default), new, close, or tab index' },
      { name: 'arg', description: 'URL for new, or index for close' },
    ],
  },
  async execute(args, resolveSession) {
    const { sessionId, client } = await resolveSession(args)
    const cmd = args.subcommand || 'list'

      // Number → switch tab
      const idx = Number(cmd)
      if (!isNaN(idx)) {
        await client.switchTab(sessionId, idx)
        ok(`Switched to tab ${idx}`, args.json)
        return
      }

      switch (cmd) {
        case 'list': {
          const r = await client.listTabs(sessionId)
          if (args.json) { console.log(JSON.stringify(r)); return }
          for (const tab of r.tabs) {
            const marker = tab.active ? pc.green('→') : ' '
            console.log(`${marker} [${tab.index}] ${tab.title || '(untitled)'} — ${tab.url}`)
          }
          break
        }
        case 'new': {
          const url = args.positionals[0]
          const r = await client.newTab(sessionId, url)
          if (args.json) output({ index: r.index }, true)
          else console.log(`Opened tab ${r.index}${url ? ` at ${url}` : ''}`)
          break
        }
        case 'close': {
          const closeIdx = args.positionals[0] ? Number(args.positionals[0]) : undefined
          await client.closeTab(sessionId, closeIdx)
          ok(`Closed tab${closeIdx != null ? ` ${closeIdx}` : ''}`, args.json)
          break
        }
        default:
          throw new Error(`Unknown tab command: ${cmd}. Use: list, new, close, or <index>`)
      }
  },
})

// ============================================================================
// frame
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'frame',
    description: 'Switch to an iframe (use "main" to return)',
    positionals: [
      { name: 'selector', description: 'CSS selector or "main"', required: true },
    ],
  },
  async execute(args, resolveSession) {
    const selector = args.subcommand
    if (!selector) throw new Error('Usage: runbrowser frame <selector>')
    const { sessionId, client } = await resolveSession(args)
      if (selector === 'main') {
        await client.switchToMainFrame(sessionId)
        ok('Switched to main frame', args.json)
      } else {
        await client.switchFrame(sessionId, selector)
        ok(`Switched to frame ${selector}`, args.json)
      }
  },
})
