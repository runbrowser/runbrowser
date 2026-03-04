/**
 * CDPExecutor - Executes browser commands directly through the Extension via CDP.
 * Replaces PlaywrightExecutor by sending CDP commands through the existing
 * Extension WebSocket instead of routing through Playwright.
 */

import type { ExecutorLike } from './server.js'
import type { ExtensionEntry } from './state.js'
import { getSnapshot, type SnapshotResult } from './snapshot.js'
import { captureScreenshot } from './screenshot.js'
import * as commands from './commands.js'

// ============================================================================
// Types
// ============================================================================

export type SendToExtension = (params: {
  extensionId?: string | null
  method: string
  params?: unknown
  timeout?: number
}) => Promise<unknown>

export type GetExtensionEntry = (stableKeyOrId: string | null) => ExtensionEntry | null

export interface CDPExecutorOptions {
  /** The stableKey of the extension to send commands to (stored in session metadata) */
  extensionStableKey: string | null
  sessionMetadata: {
    extensionId: string | null
    browser: string | null
    profile: { email: string; id: string } | null
  }
  sendToExtension: SendToExtension
  getExtensionEntry: GetExtensionEntry
  logger?: { log(...args: any[]): void; error(...args: any[]): void }
}

// ============================================================================
// CDPExecutor
// ============================================================================

export class CDPExecutor implements ExecutorLike {
  private extensionStableKey: string | null
  private metadata: {
    extensionId: string | null
    browser: string | null
    profile: { email: string; id: string } | null
  }
  private sendToExtension: SendToExtension
  private getExtensionEntry: GetExtensionEntry
  private logger?: { log(...args: any[]): void; error(...args: any[]): void }

  constructor(options: CDPExecutorOptions) {
    this.extensionStableKey = options.extensionStableKey
    this.metadata = options.sessionMetadata
    this.sendToExtension = options.sendToExtension
    this.getExtensionEntry = options.getExtensionEntry
    this.logger = options.logger
  }

  /** Get the Chrome CDP session ID of the active tab for this executor's extension. */
  private getActiveCdpSession(): { extensionId: string | null; cdpSessionId: string | null } {
    const entry = this.getExtensionEntry(this.extensionStableKey)
    if (!entry) {
      return { extensionId: null, cdpSessionId: null }
    }
    // Find first connected page target
    for (const target of entry.connectedTargets.values()) {
      if (target.targetInfo.type === 'page') {
        return { extensionId: entry.id, cdpSessionId: target.sessionId }
      }
    }
    // Fallback: return any connected target
    const first = entry.connectedTargets.values().next().value
    return { extensionId: entry.id, cdpSessionId: first?.sessionId ?? null }
  }

  /** Send a CDP command to the browser via the Extension WebSocket. Public for use in server endpoints. */
  async sendCDP(method: string, params?: unknown, timeout?: number): Promise<unknown> {
    const { extensionId, cdpSessionId } = this.getActiveCdpSession()
    if (!extensionId) {
      throw new Error('Extension not connected')
    }
    if (!cdpSessionId) {
      throw new Error('No connected browser tab found. Make sure a tab is open in Chrome.')
    }
    return this.sendToExtension({
      extensionId,
      method: 'forwardCDPCommand',
      params: { method, params, sessionId: cdpSessionId },
      timeout,
    })
  }

  // --------------------------------------------------------------------------
  // ExecutorLike interface
  // --------------------------------------------------------------------------

  async execute(
    code: string,
    timeout: number,
  ): Promise<{ text: string; images: Array<{ data: string; mimeType: string }>; isError: boolean }> {
    try {
      // Wrap in async IIFE so top-level `await` works
      const expression = `(async () => { ${code} })()`

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
  // High-level browser actions (not in ExecutorLike)
  // --------------------------------------------------------------------------

  /** Last snapshot's ref map — used for click/fill ref resolution. */
  private lastRefMap: Map<string, import('./snapshot.js').SnapshotRef> = new Map()

  async snapshot(options: { interactiveOnly?: boolean } = {}): Promise<SnapshotResult> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    const result = await getSnapshot(sendCDP, options)
    this.lastRefMap = result.refMap
    return result
  }

  async screenshot(): Promise<string> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return captureScreenshot(sendCDP)
  }

  async navigate(url: string): Promise<{ url: string; title: string }> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return commands.navigate(sendCDP, url)
  }

  async click(ref: string): Promise<void> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return commands.click(sendCDP, ref, this.lastRefMap)
  }

  async fill(ref: string, value: string): Promise<void> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return commands.fill(sendCDP, ref, value, this.lastRefMap)
  }

  async type(text: string): Promise<void> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return commands.type(sendCDP, text)
  }

  async press(key: string): Promise<void> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return commands.press(sendCDP, key)
  }

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return commands.scroll(sendCDP, direction, amount)
  }

  async hover(ref: string): Promise<void> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return commands.hover(sendCDP, ref, this.lastRefMap)
  }

  async getUrl(): Promise<string> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return commands.getUrl(sendCDP)
  }

  async getTitle(): Promise<string> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return commands.getTitle(sendCDP)
  }

  async getText(ref: string): Promise<string> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return commands.getText(sendCDP, ref, this.lastRefMap)
  }

  async goBack(): Promise<void> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return commands.goBack(sendCDP)
  }

  async goForward(): Promise<void> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return commands.goForward(sendCDP)
  }

  async reload(): Promise<void> {
    const sendCDP = (method: string, params?: unknown) => this.sendCDP(method, params)
    return commands.reload(sendCDP)
  }
}
