/**
 * Observation commands: snapshot, screenshot, get, is
 */

import fs from 'node:fs'
import { registerBuiltinCommand, type SessionResolver } from './index.js'
import type { ParsedArgs } from '../args.js'
import { output } from '../output.js'

// ============================================================================
// snapshot
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'snapshot',
    description: 'Accessibility snapshot (element tree with @refs)',
    flags: {
      interactive: { type: 'boolean', alias: 'i', description: 'Interactive elements only' },
      compact:     { type: 'boolean', alias: 'c', description: 'Remove empty containers' },
      depth:       { type: 'number',  alias: 'd', description: 'Limit tree depth' },
      selector:    { type: 'string',  alias: 'S', description: 'Scope to CSS selector' },
    },
  },
  async execute(args: ParsedArgs, resolveSession: SessionResolver) {
    const { sessionId, client } = await resolveSession(args)
      const result = await client.snapshot(sessionId, {
        interactiveOnly: args.flags.get('interactive') as boolean,
        ...(args.flags.get('compact') && { compact: true }),
        ...(args.flags.get('depth') && { maxDepth: args.flags.get('depth') as number }),
        ...(args.flags.get('selector') && { selector: args.flags.get('selector') as string }),
      })
      if (args.json) console.log(JSON.stringify(result))
      else console.log(result.snapshot)
  },
})

// ============================================================================
// screenshot
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'screenshot',
    description: 'Take a screenshot',
    positionals: [
      { name: 'path', description: 'Save to file' },
    ],
    flags: {
      full:     { type: 'boolean', alias: 'F', description: 'Full page screenshot' },
      annotate: { type: 'boolean', alias: 'a', description: 'Add numbered element labels' },
    },
  },
  async execute(args: ParsedArgs, resolveSession: SessionResolver) {
    const savePath = args.subcommand
    const { sessionId, client } = await resolveSession(args)
      const result = await client.captureScreenshot(sessionId)
      if (savePath) {
        fs.writeFileSync(savePath, Buffer.from(result.data, 'base64'))
        if (args.json) output({ path: savePath, mimeType: result.mimeType }, true)
        else console.log(`Screenshot saved to ${savePath}`)
      } else {
        if (args.json) console.log(JSON.stringify(result))
        else console.log(`Screenshot captured (${result.mimeType}, ${result.data.length} base64 chars)`)
      }
  },
})

// ============================================================================
// get
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'get',
    description: 'Get info: text, html, value, attr, url, title, count',
    positionals: [
      { name: 'what', description: 'What to get: text, html, value, attr, url, title, count', required: true },
      { name: 'ref', description: '@ref from snapshot' },
    ],
    flags: {
      'attr-name': { type: 'string', description: 'Attribute name (for `get attr`)' },
    },
  },
  async execute(args: ParsedArgs, resolveSession: SessionResolver) {
    const what = args.subcommand
    const ref = args.positionals[0]
    if (!what) throw new Error('Usage: runbrowser get <text|html|value|attr|url|title|count> [ref]')

    const { sessionId, client } = await resolveSession(args)
      switch (what) {
        case 'url': {
          const r = await client.getUrl(sessionId)
          output({ url: r.url }, args.json)
          break
        }
        case 'title': {
          const r = await client.getTitle(sessionId)
          output({ title: r.title }, args.json)
          break
        }
        case 'text': {
          if (!ref) throw new Error('ref is required for `get text`')
          const r = await client.getText(sessionId, ref)
          output({ text: r.text }, args.json)
          break
        }
        case 'html': {
          if (!ref) throw new Error('ref is required for `get html`')
          const r = await client.getHtml(sessionId, ref)
          output({ html: r.html }, args.json)
          break
        }
        case 'value': {
          if (!ref) throw new Error('ref is required for `get value`')
          const r = await client.getValue(sessionId, ref)
          output({ value: r.value }, args.json)
          break
        }
        case 'attr': {
          if (!ref) throw new Error('ref is required for `get attr`')
          const attrName = args.flags.get('attr-name') as string
          if (!attrName) throw new Error('--attr-name is required for `get attr`')
          const r = await client.getAttribute(sessionId, ref, attrName)
          output({ value: r.value }, args.json)
          break
        }
        case 'count': {
          if (!ref) throw new Error('selector is required for `get count`')
          const r = await client.getCount(sessionId, ref)
          output({ count: r.count }, args.json)
          break
        }
        default:
          throw new Error(`Unknown: ${what}. Use: text, html, value, attr, url, title, count`)
      }
  },
})

// ============================================================================
// is
// ============================================================================

registerBuiltinCommand({
  def: {
    name: 'is',
    description: 'Check element state: visible, checked, enabled',
    positionals: [
      { name: 'check', description: 'What to check: visible, checked, enabled', required: true },
      { name: 'ref', description: '@ref from snapshot', required: true },
    ],
  },
  async execute(args: ParsedArgs, resolveSession: SessionResolver) {
    const check = args.subcommand
    const ref = args.positionals[0]
    if (!check || !ref) throw new Error('Usage: runbrowser is <visible|checked|enabled> <ref>')

    const { sessionId, client } = await resolveSession(args)
      if (check === 'visible') {
        const r = await client.isVisible(sessionId, ref)
        output({ visible: r.visible }, args.json)
      } else if (check === 'checked') {
        const r = await client.isChecked(sessionId, ref)
        output({ checked: r.checked }, args.json)
      } else if (check === 'enabled') {
        const r = await client.isEnabled(sessionId, ref)
        output({ enabled: r.enabled }, args.json)
      } else {
        throw new Error(`Unknown check: ${check}. Use: visible, checked, enabled`)
      }
  },
})
