/**
 * CDPExecutor - Executes browser commands directly through a CDP WebSocket.
 *
 * Connects directly to Chrome's debugging WebSocket (ws://host:9222/devtools/browser/...)
 * without needing a Chrome extension.
 */

import WebSocket from 'ws'
import type { ExecutorLike } from './server.js'
import type { SessionMetadata } from './state.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Sends one CDP command and resolves with its raw result.
 *
 * Everything the executor exposes to callers is this shape or built from it —
 * there is deliberately no layer of named page actions on top. Chrome's
 * protocol is the API.
 */
export type SendCDP = (method: string, params?: unknown) => Promise<unknown>

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
  private readonly boundSendCDP: SendCDP

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
  // The API
  // --------------------------------------------------------------------------

  /**
   * Send an arbitrary CDP method to the active page target.
   *
   * This is the entire page-facing surface. Clicking, typing, reading the DOM
   * and capturing screenshots are all CDP methods, so none of them needs a
   * wrapper here.
   */
  async rawCDP(method: string, params?: unknown): Promise<unknown> {
    await this.ensurePageConnection()
    return this.boundSendCDP(method, params)
  }

  // --------------------------------------------------------------------------
  // Tabs
  //
  // Tabs are about the connection, not the page: which target this session is
  // bound to is state the caller cannot derive from a CDP result. Everything
  // here runs on the browser-level socket.
  // --------------------------------------------------------------------------

  /** Page targets, in a stable order, with the session's active one marked. */
  async listTabs(): Promise<Array<{ index: number; targetId: string; url: string; title: string; active: boolean }>> {
    const targets = await this.listTargets()
    return targets.map((t, index) => ({
      index,
      targetId: t.targetId,
      url: t.url,
      title: t.title,
      active: t.targetId === this.activeTargetId,
    }))
  }

  /** Open a tab and bind the session to it. */
  async newTab(url?: string): Promise<{ index: number; targetId: string }> {
    const browserWs = await this.ensureBrowserConnection()
    const created = (await this.sendViaBrowserWs(browserWs, 'Target.createTarget', {
      url: url || 'about:blank',
    })) as { targetId: string }
    await this.switchTarget(created.targetId)
    const tabs = await this.listTabs()
    const index = tabs.findIndex((t) => t.targetId === created.targetId)
    return { index: index === -1 ? tabs.length - 1 : index, targetId: created.targetId }
  }

  /** Bind the session to the tab at `index` (as reported by listTabs). */
  async switchTab(index: number): Promise<void> {
    const tabs = await this.listTabs()
    const target = tabs[index]
    if (!target) throw new Error(`No tab at index ${index} (${tabs.length} open)`)
    await this.switchTarget(target.targetId)
  }

  /** Close the tab at `index`, defaulting to the session's active tab. */
  async closeTab(index?: number): Promise<void> {
    const tabs = await this.listTabs()
    const target = index == null ? tabs.find((t) => t.active) : tabs[index]
    if (!target) {
      throw new Error(index == null ? 'No active tab to close' : `No tab at index ${index}`)
    }
    const browserWs = await this.ensureBrowserConnection()
    await this.sendViaBrowserWs(browserWs, 'Target.closeTarget', { targetId: target.targetId })

    const ws = this.pageWsMap.get(target.targetId)
    if (ws) {
      ws.close()
      this.pageWsMap.delete(target.targetId)
    }
    if (this.activeTargetId === target.targetId) this.activeTargetId = null
  }
}
