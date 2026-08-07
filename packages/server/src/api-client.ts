/**
 * HTTP API client for the relay server.
 *
 * Used by both CLI and MCP to interact with the relay server's API endpoints.
 * This is the single client library — no HTTP fetch logic should live in CLI or MCP.
 */

import { parseRelayHost } from './utils.js'
import { RELAY_PORT, type ExtensionStatus, ensureRelayServer, waitForConnectedExtensions } from './client.js'

// ============================================================================
// Types
// ============================================================================

export interface RelayClientOptions {
  /** Remote relay server host (e.g. "192.168.1.10" or "https://tunnel.example.com") */
  host?: string
  /** Authentication token for remote access */
  token?: string
  /** Logger for status messages */
  logger?: { log: (...args: any[]) => void; error: (...args: any[]) => void }
}

export interface ExecuteResult {
  text: string
  images: Array<{ data: string; mimeType: string }>
  isError: boolean
}

export interface ResetResult {
  success: boolean
  pageUrl: string
  pagesCount: number
}

export interface SessionInfo {
  id: string
  extensionId: string | null
  browser: string | null
  profile: { email: string; id: string } | null
}

export interface DownloadResult {
  /** Original filename suggested by the browser */
  suggestedFilename: string
  /** Base64-encoded file content */
  data: string
  /** Total bytes downloaded */
  totalBytes: number
}

export interface SessionListEntry {
  id: string
  stateKeys: string[]
  browser: string | null
  profile: { email: string; id: string } | null
  extensionId: string | null
}

// ============================================================================
// Relay API Client
// ============================================================================

export class RelayApiClient {
  private host: string
  private token?: string
  private logger?: { log: (...args: any[]) => void; error: (...args: any[]) => void }

  constructor(options: RelayClientOptions = {}) {
    this.host = options.host || process.env.RUNBROWSER_HOST || ''
    this.token = options.token || process.env.RUNBROWSER_TOKEN
    this.logger = options.logger
  }

  /** Whether this client connects to a remote (non-local) relay server */
  get isRemote(): boolean {
    return !!this.host
  }

  /** Get the HTTP base URL for the relay server */
  getBaseUrl(): string {
    if (this.host) {
      const { httpBaseUrl } = parseRelayHost(this.host, RELAY_PORT)
      return httpBaseUrl
    }
    return `http://127.0.0.1:${RELAY_PORT}`
  }

  /** Get auth headers for requests */
  private getAuthHeaders(): Record<string, string> {
    if (this.token) {
      return { Authorization: `Bearer ${this.token}` }
    }
    return {}
  }

  /**
   * Ensure the relay server is running (local only).
   * For remote servers, checks connectivity instead.
   */
  async ensureServer(env?: Record<string, string>): Promise<void> {
    if (this.isRemote) {
      await this.checkRemoteServer()
    } else {
      await ensureRelayServer({ logger: this.logger, env })
    }
  }

  /**
   * Check that a remote relay server is reachable.
   */
  async checkRemoteServer(): Promise<void> {
    const baseUrl = this.getBaseUrl()
    const versionUrl = `${baseUrl}/version`
    try {
      const response = await fetch(versionUrl, { signal: AbortSignal.timeout(3000) })
      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`)
      }
    } catch (error: any) {
      const isConnectionError = error.cause?.code === 'ECONNREFUSED' || error.name === 'TimeoutError'
      if (isConnectionError) {
        throw new Error(
          `Cannot connect to remote relay server at ${this.host}. ` +
            `Make sure 'npx -y runbrowser serve' is running on the host machine.`,
        )
      }
      throw new Error(`Failed to connect to remote relay server: ${error.message}`)
    }
  }

  /**
   * Wait for at least one browser extension to connect.
   */
  async waitForExtensions(options?: { timeoutMs?: number; pollIntervalMs?: number }): Promise<ExtensionStatus[]> {
    if (this.isRemote) {
      return this.fetchExtensionsStatus()
    }
    return waitForConnectedExtensions({
      timeoutMs: options?.timeoutMs ?? 15000,
      pollIntervalMs: options?.pollIntervalMs ?? 500,
      logger: this.logger,
    })
  }

  /**
   * Fetch connected extensions status from the relay server.
   */
  async fetchExtensionsStatus(): Promise<ExtensionStatus[]> {
    try {
      const baseUrl = this.getBaseUrl()
      const response = await fetch(`${baseUrl}/extensions/status`, {
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) {
        // Fallback to single-extension endpoint
        const fallback = await fetch(`${baseUrl}/extension/status`, {
          signal: AbortSignal.timeout(2000),
        })
        if (!fallback.ok) {
          return []
        }
        const fallbackData = (await fallback.json()) as {
          connected: boolean
          activeTargets: number
          browser: string | null
          profile: { email: string; id: string } | null
          extensionVersion?: string | null
        }
        if (!fallbackData?.connected) {
          return []
        }
        return [
          {
            extensionId: 'default',
            stableKey: undefined,
            browser: fallbackData?.browser,
            profile: fallbackData?.profile,
            activeTargets: fallbackData?.activeTargets,
            extensionVersion: fallbackData?.extensionVersion || null,
          },
        ]
      }
      const data = (await response.json()) as { extensions: ExtensionStatus[] }
      return data?.extensions || []
    } catch {
      return []
    }
  }

  /**
   * Send a log message to the relay server's log endpoint.
   * Fire-and-forget — never throws.
   */
  async sendLog(level: string, ...args: any[]): Promise<void> {
    try {
      const baseUrl = this.getBaseUrl()
      await fetch(`${baseUrl}/mcp-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, args }),
        signal: AbortSignal.timeout(1000),
      })
    } catch {
      // Silently fail
    }
  }

  // --------------------------------------------------------------------------
  // Session management
  // --------------------------------------------------------------------------

  /**
   * Create a new session on the relay server.
   */
  async createSession(options?: { extensionId?: string | null; cwd?: string }): Promise<SessionInfo> {
    const baseUrl = this.getBaseUrl()
    const response = await fetch(`${baseUrl}/api/session/new`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
      },
      body: JSON.stringify({
        extensionId: options?.extensionId || null,
        cwd: options?.cwd || process.cwd(),
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Failed to create session: ${response.status} ${text}`)
    }

    return (await response.json()) as SessionInfo
  }

  /**
   * List all active sessions.
   */
  async listSessions(): Promise<SessionListEntry[]> {
    const baseUrl = this.getBaseUrl()
    const response = await fetch(`${baseUrl}/api/sessions`, {
      signal: AbortSignal.timeout(2000),
      headers: this.getAuthHeaders(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Failed to list sessions: ${response.status} ${text}`)
    }

    const result = (await response.json()) as { sessions: SessionListEntry[] }
    return result.sessions
  }

  /**
   * Get info about a specific session.
   */
  async getSession(sessionId: string): Promise<SessionInfo> {
    const baseUrl = this.getBaseUrl()
    const response = await fetch(`${baseUrl}/api/session/${sessionId}`, {
      signal: AbortSignal.timeout(2000),
      headers: this.getAuthHeaders(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Session not found: ${response.status} ${text}`)
    }

    return (await response.json()) as SessionInfo
  }

  /**
   * Delete a session.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const baseUrl = this.getBaseUrl()
    const response = await fetch(`${baseUrl}/api/session/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
      },
      body: JSON.stringify({ sessionId }),
    })

    if (!response.ok) {
      const result = (await response.json()) as { error: string }
      throw new Error(result.error)
    }
  }

  // --------------------------------------------------------------------------
  // Code execution
  // --------------------------------------------------------------------------

  /**
   * Execute code in a session.
   */
  async execute(sessionId: string, code: string, timeout: number = 10000): Promise<ExecuteResult> {
    const baseUrl = this.getBaseUrl()
    const response = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
      },
      body: JSON.stringify({ sessionId, code, timeout, cwd: process.cwd() }),
      signal: AbortSignal.timeout(timeout + 5000),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Execute failed: ${response.status} ${text}`)
    }

    return (await response.json()) as ExecuteResult
  }

  /**
   * Reset the browser connection for a session.
   */
  async reset(sessionId: string): Promise<ResetResult> {
    const baseUrl = this.getBaseUrl()
    const response = await fetch(`${baseUrl}/api/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
      },
      body: JSON.stringify({ sessionId }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Reset failed: ${response.status} ${text}`)
    }

    return (await response.json()) as ResetResult
  }

  // --------------------------------------------------------------------------
  // High-level browser commands (Phase 2+)
  // --------------------------------------------------------------------------

  private async post<T>(path: string, body: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
    const baseUrl = this.getBaseUrl()
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`${path} failed: ${response.status} ${text}`)
    }
    return (await response.json()) as T
  }

  async navigate(sessionId: string, url: string): Promise<{ url: string; title: string }> {
    return this.post('/api/navigate', { sessionId, url })
  }

  async snapshot(sessionId: string, options?: { interactiveOnly?: boolean }): Promise<{ snapshot: string; refs: unknown[] }> {
    return this.post('/api/snapshot', { sessionId, ...options })
  }

  async captureScreenshot(sessionId: string): Promise<{ data: string; mimeType: string }> {
    return this.post('/api/screenshot', { sessionId })
  }

  async click(sessionId: string, ref: string): Promise<void> {
    await this.post('/api/click', { sessionId, ref })
  }

  async fill(sessionId: string, ref: string, value: string): Promise<void> {
    await this.post('/api/fill', { sessionId, ref, value })
  }

  async type(sessionId: string, text: string): Promise<void> {
    await this.post('/api/type', { sessionId, text })
  }

  async press(sessionId: string, key: string): Promise<void> {
    await this.post('/api/press', { sessionId, key })
  }

  async scroll(sessionId: string, direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void> {
    await this.post('/api/scroll', { sessionId, direction, amount })
  }

  async hover(sessionId: string, ref: string): Promise<void> {
    await this.post('/api/hover', { sessionId, ref })
  }

  async evaluate(sessionId: string, code: string, timeout?: number): Promise<ExecuteResult> {
    return this.post('/api/evaluate', { sessionId, code, timeout })
  }

  async getUrl(sessionId: string): Promise<{ url: string }> {
    return this.post('/api/get-url', { sessionId })
  }

  async getTitle(sessionId: string): Promise<{ title: string }> {
    return this.post('/api/get-title', { sessionId })
  }

  async back(sessionId: string): Promise<void> {
    await this.post('/api/back', { sessionId })
  }

  async forward(sessionId: string): Promise<void> {
    await this.post('/api/forward', { sessionId })
  }

  async reload(sessionId: string): Promise<void> {
    await this.post('/api/reload', { sessionId })
  }

  async getText(sessionId: string, ref: string): Promise<{ text: string }> {
    return this.post('/api/get-text', { sessionId, ref })
  }

  async getHtml(sessionId: string, ref: string): Promise<{ html: string }> {
    return this.post('/api/get-html', { sessionId, ref })
  }

  async getValue(sessionId: string, ref: string): Promise<{ value: string }> {
    return this.post('/api/get-value', { sessionId, ref })
  }

  async getAttribute(sessionId: string, ref: string, attr: string): Promise<{ value: string | null }> {
    return this.post('/api/get-attr', { sessionId, ref, attr })
  }

  async isVisible(sessionId: string, ref: string): Promise<{ visible: boolean }> {
    return this.post('/api/is-visible', { sessionId, ref })
  }

  async isChecked(sessionId: string, ref: string): Promise<{ checked: boolean }> {
    return this.post('/api/is-checked', { sessionId, ref })
  }

  async selectOption(sessionId: string, ref: string, value: string): Promise<void> {
    await this.post('/api/select', { sessionId, ref, value })
  }

  async waitFor(sessionId: string, options: { ref?: string; text?: string; url?: string; ms?: number; load?: string; fn?: string; timeout?: number }): Promise<void> {
    const timeoutMs = (options.timeout || 10000) + 5000
    await this.post('/api/wait', { sessionId, ...options }, timeoutMs)
  }

  async viewport(sessionId: string, width: number, height: number): Promise<void> {
    await this.post('/api/viewport', { sessionId, width, height })
  }

  async cdp(sessionId: string, method: string, params?: unknown): Promise<{ result: unknown }> {
    return this.post('/api/cdp', { sessionId, method, params })
  }

  // --------------------------------------------------------------------------
  // New interaction commands
  // --------------------------------------------------------------------------

  async dblclick(sessionId: string, ref: string): Promise<void> {
    await this.post('/api/dblclick', { sessionId, ref })
  }

  async check(sessionId: string, ref: string): Promise<void> {
    await this.post('/api/check', { sessionId, ref })
  }

  async uncheck(sessionId: string, ref: string): Promise<void> {
    await this.post('/api/uncheck', { sessionId, ref })
  }

  async focus(sessionId: string, ref: string): Promise<void> {
    await this.post('/api/focus', { sessionId, ref })
  }

  /**
   * Upload files to an <input type="file"> element.
   * For local mode, sends file paths. For remote mode, reads and base64-encodes files.
   */
  async upload(sessionId: string, ref: string, files: string[]): Promise<void> {
    if (this.isRemote) {
      // Remote: read files and send as base64
      const fs = await import('node:fs')
      const path = await import('node:path')
      const fileData = files.map((filePath) => {
        const resolved = path.resolve(filePath)
        const buffer = fs.readFileSync(resolved)
        return {
          name: path.basename(resolved),
          data: buffer.toString('base64'),
        }
      })
      await this.post('/api/upload', { sessionId, ref, fileData })
    } else {
      // Local: send absolute file paths directly
      const path = await import('node:path')
      const absoluteFiles = files.map((f) => path.resolve(f))
      await this.post('/api/upload', { sessionId, ref, files: absoluteFiles })
    }
  }

  /**
   * Download a file from the browser by clicking a ref or navigating to a URL.
   * Returns the file data as base64.
   */
  async download(sessionId: string, options: {
    ref?: string
    url?: string
    timeout?: number
  }): Promise<DownloadResult> {
    return this.post('/api/download', { sessionId, ...options }, (options.timeout ?? 30000) + 10000)
  }

  /**
   * Download a file and save it to a local path.
   */
  async downloadToFile(sessionId: string, outputPath: string, options: {
    ref?: string
    url?: string
    timeout?: number
  }): Promise<{ path: string; size: number; filename: string }> {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const result = await this.download(sessionId, options)
    const resolvedPath = path.resolve(outputPath)

    // If outputPath is a directory, use the suggested filename
    let finalPath = resolvedPath
    try {
      const stat = fs.statSync(resolvedPath)
      if (stat.isDirectory()) {
        finalPath = path.join(resolvedPath, result.suggestedFilename)
      }
    } catch {
      // Path doesn't exist — use as-is (it's a file path)
    }

    // Ensure parent directory exists
    const dir = path.dirname(finalPath)
    fs.mkdirSync(dir, { recursive: true })

    // Write the file
    const buffer = Buffer.from(result.data, 'base64')
    fs.writeFileSync(finalPath, buffer)

    return {
      path: finalPath,
      size: result.totalBytes,
      filename: result.suggestedFilename,
    }
  }

  async drag(sessionId: string, source: string, target: string): Promise<void> {
    await this.post('/api/drag', { sessionId, source, target })
  }

  async isEnabled(sessionId: string, ref: string): Promise<{ enabled: boolean }> {
    return this.post('/api/is-enabled', { sessionId, ref })
  }

  async getCount(sessionId: string, selector: string): Promise<{ count: number }> {
    return this.post('/api/get-count', { sessionId, selector })
  }

  // --------------------------------------------------------------------------
  // Tab management
  // --------------------------------------------------------------------------

  async listTabs(sessionId: string): Promise<{ tabs: Array<{ index: number; url: string; title: string; active: boolean }> }> {
    return this.post('/api/tab/list', { sessionId })
  }

  async newTab(sessionId: string, url?: string): Promise<{ index: number }> {
    return this.post('/api/tab/new', { sessionId, url })
  }

  async switchTab(sessionId: string, index: number): Promise<void> {
    await this.post('/api/tab/switch', { sessionId, index })
  }

  async closeTab(sessionId: string, index?: number): Promise<void> {
    await this.post('/api/tab/close', { sessionId, index })
  }

  // --------------------------------------------------------------------------
  // Frame management
  // --------------------------------------------------------------------------

  async switchFrame(sessionId: string, selector: string): Promise<void> {
    await this.post('/api/frame/switch', { sessionId, selector })
  }

  async switchToMainFrame(sessionId: string): Promise<void> {
    await this.post('/api/frame/main', { sessionId })
  }

  // --------------------------------------------------------------------------
  // Find + act (semantic locators)
  // --------------------------------------------------------------------------

  async findAndAct(sessionId: string, options: {
    by: string
    value: string
    action: string
    actionValue?: string
    name?: string
    exact?: boolean
    index?: number
  }): Promise<unknown> {
    return this.post('/api/find', { sessionId, ...options })
  }

  // --------------------------------------------------------------------------
  // Site commands
  // --------------------------------------------------------------------------

  async listCommands(): Promise<Array<{ site: string; name: string; description: string; args?: Record<string, any>; columns?: string[] }>> {
    try {
      const baseUrl = this.getBaseUrl()
      const response = await fetch(`${baseUrl}/api/commands`, {
        signal: AbortSignal.timeout(2000),
        headers: this.getAuthHeaders(),
      })
      if (!response.ok) return []
      const data = await response.json() as { commands: any[] }
      return data.commands || []
    } catch {
      return []
    }
  }

  async runCommand(sessionId: string, site: string, name: string, args: Record<string, any> = {}): Promise<{ data: any[]; columns: string[] }> {
    return this.post('/api/command/run', { sessionId, site, name, args })
  }

  // --------------------------------------------------------------------------
  // Diff
  // --------------------------------------------------------------------------

  async diffSnapshot(sessionId: string, baseline?: string): Promise<{ diff: string; changed: boolean }> {
    return this.post('/api/diff/snapshot', { sessionId, baseline })
  }

  async diffScreenshot(sessionId: string, baseline: string, output?: string): Promise<{ path: string; diffPixels: number }> {
    return this.post('/api/diff/screenshot', { sessionId, baseline, output })
  }

  // --------------------------------------------------------------------------
  // Recording
  // --------------------------------------------------------------------------

  async startRecording(sessionId: string, options: {
    outputPath: string
    frameRate?: number
    audio?: boolean
    videoBitsPerSecond?: number
    audioBitsPerSecond?: number
  }): Promise<StartRecordingApiResult> {
    const baseUrl = this.getBaseUrl()
    const response = await fetch(`${baseUrl}/recording/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
      body: JSON.stringify({ sessionId, ...options }),
      signal: AbortSignal.timeout(15000),
    })
    return (await response.json()) as StartRecordingApiResult
  }

  async stopRecording(sessionId: string): Promise<StopRecordingApiResult> {
    const baseUrl = this.getBaseUrl()
    const response = await fetch(`${baseUrl}/recording/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(35000),
    })
    return (await response.json()) as StopRecordingApiResult
  }

  async recordingStatus(sessionId: string): Promise<RecordingStatusApiResult> {
    const baseUrl = this.getBaseUrl()
    const url = `${baseUrl}/recording/status?sessionId=${encodeURIComponent(sessionId)}`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: this.getAuthHeaders(),
    })
    return (await response.json()) as RecordingStatusApiResult
  }

  async cancelRecording(sessionId: string): Promise<CancelRecordingApiResult> {
    const baseUrl = this.getBaseUrl()
    const response = await fetch(`${baseUrl}/recording/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(10000),
    })
    return (await response.json()) as CancelRecordingApiResult
  }

}

// ============================================================================
// Recording result types
// ============================================================================

export type StartRecordingApiResult =
  | { success: true; tabId: number; startedAt: number }
  | { success: false; error: string }

export type StopRecordingApiResult =
  | { success: true; tabId: number; duration: number; path: string; size: number }
  | { success: false; error: string }

export type RecordingStatusApiResult = {
  isRecording: boolean
  tabId?: number
  startedAt?: number
}

export type CancelRecordingApiResult = {
  success: boolean
  error?: string
}
