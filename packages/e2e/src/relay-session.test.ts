import { createMCPClient } from './mcp-client.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from 'playwright-core'
import { getCdpUrl } from '@jiweiyuan/runbrowser-server/utils'
import {
  setupTestContext,
  cleanupTestContext,
  getExtensionServiceWorker,
  createSseServer,
  safeCloseCDPBrowser,
  type TestContext,
  withTimeout,
  js,
} from './test-utils.js'
import './test-declarations.js'

const TEST_PORT = 19993


// --- Service Worker Target Tests ---

describe('Service Worker Target Tests', () => {
  let testCtx: TestContext | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-sw-test-', toggleExtension: true })
  }, 600000)

  afterAll(async () => {
    await cleanupTestContext(testCtx)
    testCtx = null
  })

  const getBrowserContext = () => {
    if (!testCtx?.browserContext) throw new Error('Browser not initialized')
    return testCtx.browserContext
  }

  it('should not expose service worker targets to Playwright (issue #14)', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('https://web.dev/', { waitUntil: 'load' })
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 500))

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const context = browser.contexts()[0]

    const pages = context.pages()

    for (const p of pages) {
      const url = p.url()
      console.log('Page URL:', url)
      expect(url).not.toMatch(/sw\.js$/i)
      expect(url).not.toMatch(/service.?worker/i)
    }

    const targetPage = pages.find((p) => p.url().includes('web.dev'))
    expect(targetPage).toBeDefined()

    const title = await targetPage!.title()
    expect(title).toBeTruthy()

    await safeCloseCDPBrowser(browser)
    await page.close()
  }, 60000)


  it('should stream SSE without waiting for response end', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await withTimeout({
      promise: getExtensionServiceWorker(browserContext),
      timeoutMs: 5000,
      errorMessage: 'getExtensionServiceWorker timed out',
    })
    const sseServer = await withTimeout({
      promise: createSseServer(),
      timeoutMs: 5000,
      errorMessage: 'createSseServer timed out',
    })
    let page: Awaited<ReturnType<typeof browserContext.newPage>> | null = null
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null

    try {
      page = await withTimeout({
        promise: browserContext.newPage(),
        timeoutMs: 5000,
        errorMessage: 'newPage timed out',
      })
      await withTimeout({
        promise: page.goto(`${sseServer.baseUrl}/`),
        timeoutMs: 5000,
        errorMessage: 'page.goto timed out',
      })
      await page.bringToFront()

      await withTimeout({
        promise: serviceWorker.evaluate(async () => {
          await globalThis.toggleExtensionForActiveTab()
        }),
        timeoutMs: 5000,
        errorMessage: 'toggleExtensionForActiveTab timed out',
      })
      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })

      browser = await withTimeout({
        promise: chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT })),
        timeoutMs: 5000,
        errorMessage: 'connectOverCDP timed out',
      })
      const cdpPage = browser
        .contexts()[0]
        .pages()
        .find((p) => {
          return p.url().startsWith(sseServer.baseUrl)
        })
      expect(cdpPage).toBeDefined()

      await cdpPage!.evaluate(() => {
        return window.startSse()
      })
      await withTimeout({
        promise: cdpPage!.waitForFunction(
          () => {
            return window.__sseMessages.length > 0
          },
          { timeout: 5000 },
        ),
        timeoutMs: 7000,
        errorMessage: 'SSE message not received in time',
      })

      const firstMessage = await cdpPage!.evaluate(() => {
        return window.__sseMessages[0]
      })
      expect(firstMessage).toBe('hello')

      const sseState = sseServer.getState()
      expect(sseState.connected).toBe(true)
      expect(sseState.finished).toBe(false)
      expect(sseState.closed).toBe(false)
      expect(sseState.writeCount).toBeGreaterThan(0)

      const readyState = await cdpPage!.evaluate(() => {
        if (!window.__sseSource) {
          return -1
        }
        return window.__sseSource.readyState
      })
      expect(readyState).toBe(1)

      await cdpPage!.evaluate(() => {
        window.stopSse()
      })
      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })
    } finally {
      if (browser) {
        await withTimeout({
          promise: browser.close(),
          timeoutMs: 5000,
          errorMessage: 'browser.close timed out',
        })
      }
      if (page) {
        await withTimeout({
          promise: page.close(),
          timeoutMs: 5000,
          errorMessage: 'page.close timed out',
        })
      }
      await withTimeout({
        promise: sseServer.close(),
        timeoutMs: 5000,
        errorMessage: 'sseServer.close timed out',
      })
    }
  }, 60000)
})

// --- Auto-enable Tests ---

describe('Auto-enable Tests', () => {
  let testCtx: TestContext | null = null
  let client: Awaited<ReturnType<typeof createMCPClient>>['client']
  let cleanup: (() => Promise<void>) | null = null

  beforeAll(async () => {
    process.env.RUNBROWSER_AUTO_ENABLE = '1'
    testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-auto-test-' })

    const result = await createMCPClient({ port: TEST_PORT })
    client = result.client
    cleanup = result.cleanup

    // Disconnect all tabs to start with a clean state
    const serviceWorker = await getExtensionServiceWorker(testCtx.browserContext)
    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })
    await new Promise((r) => setTimeout(r, 100))
  }, 600000)

  afterAll(async () => {
    delete process.env.RUNBROWSER_AUTO_ENABLE
    await cleanupTestContext(testCtx, cleanup)
    cleanup = null
    testCtx = null
  })

  const getBrowserContext = () => {
    if (!testCtx?.browserContext) throw new Error('Browser not initialized')
    return testCtx.browserContext
  }

  it('should auto-create a tab when Playwright connects and no tabs exist', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })
    await new Promise((r) => setTimeout(r, 100))

    const tabCountBefore = await serviceWorker.evaluate(() => {
      const state = globalThis.getExtensionState()
      return state.tabs.size
    })
    expect(tabCountBefore).toBe(0)

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))

    const pages = browser.contexts()[0].pages()
    expect(pages.length).toBeGreaterThan(0)
    expect(pages.length).toBe(1)

    const autoCreatedPage = pages[0]
    expect(autoCreatedPage.url()).toBe('about:blank')

    const tabCountAfter = await serviceWorker.evaluate(() => {
      const state = globalThis.getExtensionState()
      return state.tabs.size
    })
    expect(tabCountAfter).toBe(1)

    await autoCreatedPage.setContent('<h1>Auto-created page</h1>')
    const title = await autoCreatedPage.locator('h1').textContent()
    expect(title).toBe('Auto-created page')

    await browser.close()
  }, 60000)

})
