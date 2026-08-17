/**
 * exec + the event buffer, against a real Chrome through the extension.
 *
 * These assert the two things unit tests cannot: that a snippet reaches the
 * page, and that CDP events actually accumulate somewhere a later call can
 * read them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
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

async function cli(args: string[], stdin?: string) {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    env: { ...process.env, TERMIO_BROWSER_PORT: String(PORT) },
    stdin: stdin ? new TextEncoder().encode(stdin) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  return { out: out.trim(), err: err.trim(), code: proc.exitCode }
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
