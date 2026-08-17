/**
 * exec + the event buffer, against a real Chrome through the extension.
 *
 * These assert the two things unit tests cannot: that a snippet reaches the
 * page, and that CDP events actually accumulate somewhere a later call can
 * read them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { setupTestContext, cleanupTestContext, type TestContext } from './test-utils.js'

const PORT = 19998
const CLI = new URL('../../browser/src/cli/cli.ts', import.meta.url).pathname

let ctx: TestContext | null = null

beforeAll(async () => {
  ctx = await setupTestContext({ port: PORT, tempDirPrefix: 'exec-', toggleExtension: true })
}, 120_000)

afterAll(async () => {
  await cleanupTestContext(ctx, null).catch(() => {})
})

// The CLI runs under bun; these tests run under Node because Playwright does
// not support Bun. Spawning across that line is the point of the split.
function cli(args: string[], stdin?: string): Promise<{ out: string; err: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('bun', [CLI, ...args], {
      env: { ...process.env, RUNBROWSER_PORT: String(PORT) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (err += d))
    if (stdin) proc.stdin.end(stdin)
    else proc.stdin.end()
    proc.on('close', (code) => resolve({ out: out.trim(), err: err.trim(), code: code ?? 1 }))
  })
}

describe('exec', () => {
  it('lists the helpers in scope', async () => {
    const { out } = await cli(['exec', '--helpers'])
    expect(out).toContain('cdp')
    expect(out).toContain('drainEvents')
  })

  it('runs a snippet against the page', async () => {
    const { out, err } = await cli(['exec'], `
      await cdp('Page.enable')
      await cdp('Page.navigate', { url: 'https://example.com' })
      await waitFor(async () => (await evaluate('document.readyState')) === 'complete', { label: 'load' })
      return await evaluate('document.title')
    `)
    expect(`${out} ${err}`).toContain('Example Domain')
  }, 60_000)

  it('reports the active tab through pageInfo', async () => {
    const { out, err } = await cli(['exec'], `
      const info = await pageInfo()
      return { url: info.active.url, tabs: info.tabs.length }
    `)
    expect(`${out} ${err}`).toContain('example.com')
  }, 60_000)

  it('buffers CDP events for a later call to drain', async () => {
    const { out, err } = await cli(['exec'], `
      await setEventFilter('^Page\\\\.')
      await drainEvents()
      await cdp('Page.navigate', { url: 'https://example.com/?second' })
      await waitFor(async () => (await drainEvents({ peek: true })).events.length > 0, { label: 'events' })
      const { events, dropped } = await drainEvents()
      return { count: events.length, dropped }
    `)
    const parsed = JSON.parse(out || '{}')
    expect(parsed.count, `${out} ${err}`).toBeGreaterThan(0)
    expect(parsed.dropped).toBe(0)
  }, 60_000)

  it('exits non-zero when a snippet throws', async () => {
    const { code } = await cli(['exec'], `return await evaluate('this is not valid js (((')`)
    expect(code).not.toBe(0)
  }, 60_000)
})
