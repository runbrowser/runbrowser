/**
 * CDPExecutor - Executes browser commands directly through the Extension via CDP.
 * Replaces PlaywrightExecutor by sending CDP commands through the existing
 * Extension WebSocket instead of routing through Playwright.
 */

import type { ExecutorLike } from './server.js'
import type { ExtensionEntry, SessionMetadata } from './state.js'
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
  sessionMetadata: SessionMetadata
  sendToExtension: SendToExtension
  getExtensionEntry: GetExtensionEntry
  logger?: { log(...args: any[]): void; error(...args: any[]): void }
}

// ============================================================================
// CDPExecutor
// ============================================================================

export class CDPExecutor implements ExecutorLike {
  private extensionStableKey: string | null
  private metadata: SessionMetadata
  private sendToExtension: SendToExtension
  private getExtensionEntry: GetExtensionEntry
  private logger?: { log(...args: any[]): void; error(...args: any[]): void }

  /** Bound sendCDP — avoids creating a new closure in every method call. */
  private readonly boundSendCDP: commands.SendCDP

  constructor(options: CDPExecutorOptions) {
    this.extensionStableKey = options.extensionStableKey
    this.metadata = options.sessionMetadata
    this.sendToExtension = options.sendToExtension
    this.getExtensionEntry = options.getExtensionEntry
    this.logger = options.logger
    this.boundSendCDP = (method, params) => this.sendCDP(method, params)
  }

  /** Get the Chrome CDP session ID of the active tab for this executor's extension. */
  getActiveCdpSession(): { extensionId: string | null; cdpSessionId: string | null } {
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
    let { extensionId, cdpSessionId } = this.getActiveCdpSession()
    if (!extensionId) {
      throw new Error('Extension not connected')
    }
    if (!cdpSessionId) {
      // Auto-create a tab instead of failing
      cdpSessionId = await this.autoCreateTab(extensionId)
    }
    return this.sendToExtension({
      extensionId,
      method: 'forwardCDPCommand',
      params: { method, params, sessionId: cdpSessionId },
      timeout,
    })
  }

  /** Auto-create a browser tab when none are attached */
  private async autoCreateTab(extensionId: string): Promise<string> {
    const result = (await this.sendToExtension({
      extensionId,
      method: 'createInitialTab',
      timeout: 10000,
    })) as { success: boolean; sessionId: string; targetInfo: any }

    if (!result?.success || !result.sessionId) {
      throw new Error('No connected browser tab found and failed to auto-create one. Click the RunBrowser extension icon on a tab.')
    }

    // Note: target registration in relay state is handled by the extension-ws
    // route when it receives the Target.attachedToTarget event from the extension.
    // We don't mutate connectedTargets directly here (that would be Feature Envy).

    return result.sessionId
  }

  // --------------------------------------------------------------------------
  // ExecutorLike interface
  // --------------------------------------------------------------------------

  async execute(
    code: string,
    timeout: number,
  ): Promise<{ text: string; images: Array<{ data: string; mimeType: string }>; isError: boolean }> {
    try {
      // Try direct expression evaluation first (handles `document.title`, `1+1`, etc.)
      // Fall back to async IIFE wrapper only for multi-statement code (has semicolons or explicit return)
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
    const result = await getSnapshot(this.boundSendCDP, options)
    this.lastRefMap = result.refMap
    return result
  }

  async screenshot(): Promise<string> {
    return captureScreenshot(this.boundSendCDP)
  }

  async navigate(url: string): Promise<{ url: string; title: string }> {
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
