/**
 * CDPExecutor - Executes browser commands directly through a CDP WebSocket.
 *
 * Connects directly to Chrome's debugging WebSocket (ws://host:9222/devtools/browser/...)
 * without needing a Chrome extension.
 */

import WebSocket from 'ws'
import type { ExecutorLike } from './server.js'
import type { SessionMetadata } from './state.js'
import { getSnapshot, type SnapshotResult } from './snapshot.js'
import { captureScreenshot } from './screenshot.js'
import * as commands from './commands.js'

// ============================================================================
// Types
// ============================================================================

export interface CDPExecutorOptions {
  /** Direct CDP WebSocket URL (e.g. ws://127.0.0.1:9222/devtools/browser/...) */
  cdpUrl: string
  sessionMetadata: SessionMetadata
  logger?: { log(...args: any[]): void; error(...args: any[]): void }
}

// ============================================================================
// CDPExecutor
// ============================================================================

export class CDPExecutor implements ExecutorLike {
  private cdpUrl: string
  private metadata: SessionMetadata
  private logger?: { log(...args: any[]): void; error(...args: any[]): void }

  /** Bound sendCDP — avoids creating a new closure in every method call. */
  private readonly boundSendCDP: commands.SendCDP

  /** WebSocket connection to Chrome's browser-level CDP endpoint */
  private browserWs: WebSocket | null = null

  /** Per-page WebSocket connections, keyed by targetId */
  private pageWsMap: Map<string, WebSocket> = new Map()

  /** Current active target (page) session ID and WebSocket */
  private activeTargetId: string | null = null

  /** Message ID counter for CDP commands */
  private nextId = 1

  /** Pending CDP responses keyed by message ID */
  private pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }> = new Map()

  constructor(options: CDPExecutorOptions) {
    this.cdpUrl = options.cdpUrl
    this.metadata = options.sessionMetadata
    this.logger = options.logger
    this.boundSendCDP = (method, params) => this.sendCDP(method, params)
  }

  // --------------------------------------------------------------------------
  // Connection management
  // --------------------------------------------------------------------------

  /** Connect to Chrome's browser-level CDP WebSocket and discover a page target. */
  private async ensureBrowserConnection(): Promise<WebSocket> {
    if (this.browserWs && this.browserWs.readyState === WebSocket.OPEN) {
      return this.browserWs
    }

    this.browserWs = await this.connectWs(this.cdpUrl)
    return this.browserWs
  }

  /** Connect a WebSocket and wait for it to open. */
  private connectWs(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error(`WebSocket connection timeout: ${url}`))
      }, 10000)

      ws.on('open', () => {
        clearTimeout(timeout)
        resolve(ws)
      })
      ws.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  /** Get (or create) a page-level CDP WebSocket for the active target. */
  private async ensurePageConnection(): Promise<{ ws: WebSocket; targetId: string }> {
    // If we already have an active page WS, use it
    if (this.activeTargetId) {
      const existing = this.pageWsMap.get(this.activeTargetId)
      if (existing && existing.readyState === WebSocket.OPEN) {
        return { ws: existing, targetId: this.activeTargetId }
      }
      // Stale connection — clean up
      this.pageWsMap.delete(this.activeTargetId)
      this.activeTargetId = null
    }

    // Discover page targets via the browser WS
    const browserWs = await this.ensureBrowserConnection()
    const targets = await this.sendViaBrowserWs(browserWs, 'Target.getTargets', {}) as {
      targetInfos: Array<{ targetId: string; type: string; url: string; title: string }>
    }

    // Find a suitable page target (not about:blank if possible)
    const pages = targets.targetInfos.filter((t) => t.type === 'page')
    if (pages.length === 0) {
      // Create a new tab
      const created = await this.sendViaBrowserWs(browserWs, 'Target.createTarget', { url: 'about:blank' }) as {
        targetId: string
      }
      return this.attachToTarget(browserWs, created.targetId)
    }

    // Prefer non-blank pages
    const preferred = pages.find((p) => p.url !== 'about:blank') || pages[0]
    return this.attachToTarget(browserWs, preferred.targetId)
  }

  /** Attach to a target and set up a page-level WebSocket. */
  private async attachToTarget(browserWs: WebSocket, targetId: string): Promise<{ ws: WebSocket; targetId: string }> {
    // Get the WS URL for this specific target
    const wsUrlBase = this.cdpUrl.replace(/\/devtools\/browser\/.*/, '')
    const pageWsUrl = `${wsUrlBase}/devtools/page/${targetId}`

    const ws = await this.connectWs(pageWsUrl)

    // Set up message handling
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.id !== undefined) {
          const p = this.pending.get(msg.id)
          if (p) {
            this.pending.delete(msg.id)
            if (msg.error) {
              p.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
            } else {
              p.resolve(msg.result)
            }
          }
        }
        // CDP events — could be used for navigation tracking etc.
      } catch {
        // ignore parse errors
      }
    })

    ws.on('close', () => {
      this.pageWsMap.delete(targetId)
      if (this.activeTargetId === targetId) {
        this.activeTargetId = null
      }
    })

    ws.on('error', (err) => {
      this.logger?.error('Page WebSocket error:', err)
    })

    this.pageWsMap.set(targetId, ws)
    this.activeTargetId = targetId
    return { ws, targetId }
  }

  /** Send a CDP command via the browser-level WebSocket and wait for response. */
  private sendViaBrowserWs(ws: WebSocket, method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 30000)

      const handler = (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString())
          if (msg.id === id) {
            clearTimeout(timeout)
            ws.off('message', handler)
            if (msg.error) {
              reject(new Error(msg.error.message || JSON.stringify(msg.error)))
            } else {
              resolve(msg.result)
            }
          }
        } catch {
          // ignore
        }
      }

      ws.on('message', handler)
      ws.send(JSON.stringify({ id, method, params: params || {} }))
    })
  }

  // --------------------------------------------------------------------------
  // CDP command interface
  // --------------------------------------------------------------------------

  /** Send a CDP command to the active page target. */
  async sendCDP(method: string, params?: unknown, timeout?: number): Promise<unknown> {
    const { ws } = await this.ensurePageConnection()

    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timeoutMs = timeout || 30000
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })

      ws.send(JSON.stringify({ id, method, params: params || {} }))
    })
  }

  /** Switch to a different page target by targetId. */
  async switchTarget(targetId: string): Promise<void> {
    const existing = this.pageWsMap.get(targetId)
    if (existing && existing.readyState === WebSocket.OPEN) {
      this.activeTargetId = targetId
      return
    }

    const browserWs = await this.ensureBrowserConnection()
    await this.attachToTarget(browserWs, targetId)
  }

  /** List all page targets. */
  async listTargets(): Promise<Array<{ targetId: string; url: string; title: string }>> {
    const browserWs = await this.ensureBrowserConnection()
    const result = await this.sendViaBrowserWs(browserWs, 'Target.getTargets', {}) as {
      targetInfos: Array<{ targetId: string; type: string; url: string; title: string }>
    }
    return result.targetInfos.filter((t) => t.type === 'page')
  }

  /** Clean up all WebSocket connections. */
  async dispose(): Promise<void> {
    for (const ws of this.pageWsMap.values()) {
      ws.close()
    }
    this.pageWsMap.clear()
    this.activeTargetId = null

    if (this.browserWs) {
      this.browserWs.close()
      this.browserWs = null
    }

    // Reject all pending
    for (const [id, p] of this.pending) {
      p.reject(new Error('Executor disposed'))
    }
    this.pending.clear()
  }

  // --------------------------------------------------------------------------
  // ExecutorLike interface
  // --------------------------------------------------------------------------

  async execute(
    code: string,
    timeout: number,
  ): Promise<{ text: string; images: Array<{ data: string; mimeType: string }>; isError: boolean }> {
    try {
      // Ensure we have a page connection
      await this.ensurePageConnection()

      const trimmed = code.trim()
      const isMultiStatement = trimmed.includes(';') || trimmed.startsWith('return ')
      const expression = isMultiStatement
        ? `(async () => { ${trimmed} })()`
        : trimmed

      const result = (await this.sendCDP(
        'Runtime.evaluate',
        {
          expression,
          awaitPromise: true,
          returnByValue: true,
          timeout,
        },
        timeout + 5000,
      )) as any

      if (result?.exceptionDetails) {
        const errMsg =
          result.exceptionDetails.exception?.description ||
          result.exceptionDetails.exception?.value ||
          result.exceptionDetails.text ||
          'Unknown error'
        return { text: errMsg, images: [], isError: true }
      }

      const value = result?.result?.value
      const text =
        value === undefined || value === null
          ? String(value)
          : typeof value === 'string'
            ? value
            : JSON.stringify(value, null, 2)

      return { text, images: [], isError: false }
    } catch (error: any) {
      return { text: `CDP Error: ${error.message}`, images: [], isError: true }
    }
  }

  async reset(): Promise<{ page: { url(): string }; context: { pages(): any[] } }> {
    try {
      await this.ensurePageConnection()
      await this.sendCDP('Runtime.enable', {})
      const urlResult = (await this.sendCDP('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true,
      })) as any
      const url = urlResult?.result?.value || 'about:blank'
      return {
        page: { url: () => url },
        context: { pages: () => [{}] },
      }
    } catch {
      return {
        page: { url: () => 'about:blank' },
        context: { pages: () => [{}] },
      }
    }
  }

  getSessionMetadata() {
    return this.metadata
  }

  // --------------------------------------------------------------------------
  // High-level browser actions
  // --------------------------------------------------------------------------

  private lastRefMap: Map<string, import('./snapshot.js').SnapshotRef> = new Map()

  async snapshot(options: { interactiveOnly?: boolean } = {}): Promise<SnapshotResult> {
    await this.ensurePageConnection()
    const result = await getSnapshot(this.boundSendCDP, options)
    this.lastRefMap = result.refMap
    return result
  }

  async screenshot(): Promise<string> {
    await this.ensurePageConnection()
    return captureScreenshot(this.boundSendCDP)
  }

  async navigate(url: string): Promise<{ url: string; title: string }> {
    await this.ensurePageConnection()
    return commands.navigate(this.boundSendCDP, url)
  }

  async click(ref: string): Promise<void> {
    return commands.click(this.boundSendCDP, ref, this.lastRefMap)
  }

  async fill(ref: string, value: string): Promise<void> {
    return commands.fill(this.boundSendCDP, ref, value, this.lastRefMap)
  }

  async type(text: string): Promise<void> {
    return commands.type(this.boundSendCDP, text)
  }

  async press(key: string): Promise<void> {
    return commands.press(this.boundSendCDP, key)
  }

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void> {
    return commands.scroll(this.boundSendCDP, direction, amount)
  }

  async hover(ref: string): Promise<void> {
    return commands.hover(this.boundSendCDP, ref, this.lastRefMap)
  }

  async getUrl(): Promise<string> {
    return commands.getUrl(this.boundSendCDP)
  }

  async getTitle(): Promise<string> {
    return commands.getTitle(this.boundSendCDP)
  }

  async getText(ref: string): Promise<string> {
    return commands.getText(this.boundSendCDP, ref, this.lastRefMap)
  }

  async getHtml(ref: string): Promise<string> {
    return commands.getHtml(this.boundSendCDP, ref, this.lastRefMap)
  }

  async getValue(ref: string): Promise<string> {
    return commands.getValue(this.boundSendCDP, ref, this.lastRefMap)
  }

  async getAttribute(ref: string, attr: string): Promise<string | null> {
    return commands.getAttribute(this.boundSendCDP, ref, attr, this.lastRefMap)
  }

  async isVisible(ref: string): Promise<boolean> {
    return commands.isVisible(this.boundSendCDP, ref, this.lastRefMap)
  }

  async isChecked(ref: string): Promise<boolean> {
    return commands.isChecked(this.boundSendCDP, ref, this.lastRefMap)
  }

  async selectOption(ref: string, value: string): Promise<void> {
    return commands.selectOption(this.boundSendCDP, ref, value, this.lastRefMap)
  }

  async waitFor(options: { ref?: string; text?: string; url?: string; ms?: number; load?: string; fn?: string }, timeout?: number): Promise<void> {
    return commands.waitFor(this.boundSendCDP, options, this.lastRefMap, timeout)
  }

  async viewport(width: number, height: number): Promise<void> {
    return commands.viewport(this.boundSendCDP, width, height)
  }

  async upload(ref: string, files: string[]): Promise<void> {
    return commands.upload(this.boundSendCDP, ref, files, this.lastRefMap)
  }

  async uploadBase64(ref: string, fileData: Array<{ name: string; data: string; mimeType?: string }>, tempDir: string): Promise<void> {
    return commands.uploadBase64(this.boundSendCDP, ref, fileData, this.lastRefMap, tempDir)
  }

  async download(options: { ref?: string; url?: string; timeout?: number }): Promise<commands.DownloadResult> {
    return commands.download(this.boundSendCDP, options, this.lastRefMap)
  }

  async rawCDP(method: string, params?: unknown): Promise<unknown> {
    return this.boundSendCDP(method, params)
  }

  async goBack(): Promise<void> {
    return commands.goBack(this.boundSendCDP)
  }

  async goForward(): Promise<void> {
    return commands.goForward(this.boundSendCDP)
  }

  async reload(): Promise<void> {
    return commands.reload(this.boundSendCDP)
  }
}
