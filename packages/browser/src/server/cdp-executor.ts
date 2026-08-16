/**
 * CDPExecutor - Executes browser commands directly through the Extension via CDP.
 * Replaces PlaywrightExecutor by sending CDP commands through the existing
 * Extension WebSocket instead of routing through Playwright.
 */

import type { ExecutorLike } from './server.js'
import type { ExtensionEntry, SessionMetadata } from './state.js'

/**
 * Sends one CDP command and resolves with its raw result.
 *
 * Everything this executor exposes to callers is this shape or built from it —
 * there is deliberately no layer of named page actions on top. Chrome's
 * protocol is the API.
 */
export type SendCDP = (method: string, params?: unknown) => Promise<unknown>

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

export type RegisterTarget = (params: {
  extensionId: string
  sessionId: string
  targetId: string
  targetInfo: any
}) => void

export interface CDPExecutorOptions {
  /** The stableKey of the extension to send commands to (stored in session metadata) */
  extensionStableKey: string | null
  sessionMetadata: SessionMetadata
  sendToExtension: SendToExtension
  getExtensionEntry: GetExtensionEntry
  registerTarget?: RegisterTarget
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
  private registerTarget?: RegisterTarget
  private logger?: { log(...args: any[]): void; error(...args: any[]): void }

  /** Bound sendCDP — avoids creating a new closure in every method call. */
  private readonly boundSendCDP: SendCDP

  /** True while a cross-origin navigation is in progress — prevents autoCreateTab during target re-attachment. */
  private waitForReattach = false

  /**
   * The target this session is bound to, if the caller chose one.
   *
   * Null means "whichever page target the extension attached first", which is
   * the right default for a fresh session. Once a caller switches tabs the
   * choice must stick, or every subsequent command silently drifts back to the
   * first tab.
   */
  private boundTargetId: string | null = null

  constructor(options: CDPExecutorOptions) {
    this.extensionStableKey = options.extensionStableKey
    this.metadata = options.sessionMetadata
    this.sendToExtension = options.sendToExtension
    this.getExtensionEntry = options.getExtensionEntry
    this.registerTarget = options.registerTarget
    this.logger = options.logger
    this.boundSendCDP = (method, params) => this.sendCDP(method, params)
  }

  /** Get the Chrome CDP session ID of the active tab for this executor's extension. */
  getActiveCdpSession(): { extensionId: string | null; cdpSessionId: string | null } {
    const entry = this.getExtensionEntry(this.extensionStableKey)
    if (!entry) {
      return { extensionId: null, cdpSessionId: null }
    }
    // An explicitly bound target wins, so a tab switch survives the next call.
    if (this.boundTargetId) {
      for (const target of entry.connectedTargets.values()) {
        if (target.targetId === this.boundTargetId) {
          return { extensionId: entry.id, cdpSessionId: target.sessionId }
        }
      }
      // The bound tab is gone (closed, or crashed). Fall through to the default
      // rather than failing every command until the caller notices.
      this.boundTargetId = null
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

  /** The target this session is bound to, for `status` to report. */
  getBoundTargetId(): string | null {
    return this.boundTargetId
  }

  /** Send a CDP command to the browser via the Extension WebSocket. Public for use in server endpoints. */
  async sendCDP(method: string, params?: unknown, timeout?: number): Promise<unknown> {
    let { extensionId, cdpSessionId } = this.getActiveCdpSession()
    if (!extensionId) {
      throw new Error('Extension not connected')
    }
    if (!cdpSessionId) {
      if (this.waitForReattach) {
        // During cross-origin navigation, wait for the target to re-attach instead
        // of creating a new tab. Chrome detaches the old target and re-attaches
        // with a new session ID after the navigation commits.
        cdpSessionId = await this.waitForTarget(10000)
        if (!cdpSessionId) {
          throw new Error('Navigation target lost — no CDP session re-attached within timeout')
        }
      } else {
        // Auto-create a tab instead of failing
        cdpSessionId = await this.autoCreateTab(extensionId)
      }
    }
    return this.sendToExtension({
      extensionId,
      method: 'forwardCDPCommand',
      params: { method, params, sessionId: cdpSessionId },
      timeout,
    })
  }

  /**
   * Poll for a CDP target to (re-)appear on this extension.
   * Used during cross-origin navigations where Chrome detaches the old target
   * and re-attaches a new one after a brief gap.
   */
  private async waitForTarget(maxWaitMs: number): Promise<string | null> {
    const start = Date.now()
    while (Date.now() - start < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      const { cdpSessionId } = this.getActiveCdpSession()
      if (cdpSessionId) return cdpSessionId
    }
    return null
  }

  /** Auto-create a browser tab when none are attached */
  private async autoCreateTab(extensionId: string): Promise<string> {
    const result = (await this.sendToExtension({
      extensionId,
      method: 'createInitialTab',
      timeout: 10000,
    })) as { success: boolean; sessionId: string; targetInfo: any }

    if (!result?.success || !result.sessionId) {
      throw new Error('No connected browser tab found and failed to auto-create one. Click the termio browser extension icon on a tab.')
    }

    // Register the target in relay state ourselves.
    // The extension uses skipAttachedEvent: true for createInitialTab (to avoid
    // duplicates with Playwright's Target.setAutoAttach), so the normal
    // Target.attachedToTarget → handleTargetAttached registration path is skipped.
    // Without this, connectedTargets stays empty and every subsequent sendCDP
    // call creates another blank tab.
    if (this.registerTarget && result.targetInfo) {
      this.registerTarget({
        extensionId,
        sessionId: result.sessionId,
        targetId: result.targetInfo.targetId,
        targetInfo: result.targetInfo,
      })
    }

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

  // --------------------------------------------------------------------------
  // The API
  // --------------------------------------------------------------------------

  /**
   * Send an arbitrary CDP method to the session's active tab.
   *
   * This is the entire page-facing surface. Clicking, typing, reading the DOM
   * and capturing screenshots are all CDP methods, so none of them needs a
   * wrapper here.
   */
  async rawCDP(method: string, params?: unknown): Promise<unknown> {
    return this.boundSendCDP(method, params)
  }

  // --------------------------------------------------------------------------
  // Tabs
  //
  // Tabs are about the connection, not the page: which target a session is
  // bound to is state the caller cannot derive from a CDP result. Addressed by
  // target id — Target.getTargets makes no ordering guarantee, so an index
  // captured in one call can name a different tab in the next.
  // --------------------------------------------------------------------------

  async listTabs(): Promise<Array<{ index: number; targetId: string; url: string; title: string; active: boolean }>> {
    const result = (await this.sendCDP('Target.getTargets')) as {
      targetInfos: Array<{ targetId: string; type: string; url: string; title: string }>
    }
    const pages = (result?.targetInfos ?? []).filter((t) => t.type === 'page')
    const { cdpSessionId } = this.getActiveCdpSession()
    const entry = this.getExtensionEntry(this.extensionStableKey)
    const activeTargetId = entry
      ? [...entry.connectedTargets.values()].find((t) => t.sessionId === cdpSessionId)?.targetId ?? null
      : null
    return pages.map((t, index) => ({
      index,
      targetId: t.targetId,
      url: t.url,
      title: t.title,
      active: t.targetId === activeTargetId,
    }))
  }

  async newTab(url?: string): Promise<{ targetId: string; url: string }> {
    const created = (await this.sendCDP('Target.createTarget', {
      url: url || 'about:blank',
    })) as { targetId: string }
    // Opening a tab and then acting on the previous one is never what a caller
    // meant, so binding follows creation.
    this.boundTargetId = created.targetId
    return { targetId: created.targetId, url: url || 'about:blank' }
  }

  /** Bind this session to `targetId`, and bring that tab to the front. */
  async switchTab(targetId: string): Promise<void> {
    const tabs = await this.listTabs()
    if (!tabs.some((t) => t.targetId === targetId)) {
      throw new Error(`No tab with target id ${targetId}`)
    }
    await this.sendCDP('Target.activateTarget', { targetId })
    this.boundTargetId = targetId
  }

  async closeTab(targetId?: string): Promise<void> {
    let id = targetId
    if (!id) {
      const active = (await this.listTabs()).find((t) => t.active)
      if (!active) throw new Error('No active tab to close')
      id = active.targetId
    }
    await this.sendCDP('Target.closeTarget', { targetId: id })
    if (this.boundTargetId === id) this.boundTargetId = null
  }
}
