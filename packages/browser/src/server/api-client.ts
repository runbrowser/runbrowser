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
    this.host = options.host || process.env.TERMIO_BROWSER_HOST || ''
    this.token = options.token || process.env.TERMIO_BROWSER_TOKEN
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
  // Browser API
  //
  // Two calls reach the page: cdp and evaluate. Everything a caller wants to
  // do to a document is a CDP method, so there is no per-action client method
  // to keep in sync with a route, a CLI flag and a doc line.
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

  /** Send a raw CDP command to the session's active tab. */
  async cdp(sessionId: string, method: string, params?: unknown): Promise<{ result: unknown }> {
    return this.post('/api/cdp', { sessionId, method, params })
  }

  /** Runtime.evaluate with the result marshalled to text. */
  async evaluate(sessionId: string, code: string, timeout?: number): Promise<ExecuteResult> {
    return this.post('/api/evaluate', { sessionId, code, timeout })
  }

  // --------------------------------------------------------------------------
  // Tabs — connection state, not page state
  // --------------------------------------------------------------------------

  async listTabs(sessionId: string): Promise<{ tabs: Array<{ index: number; targetId: string; url: string; title: string; active: boolean }> }> {
    return this.post('/api/tab/list', { sessionId })
  }

  async newTab(sessionId: string, url?: string): Promise<{ targetId: string; url: string }> {
    return this.post('/api/tab/new', { sessionId, url })
  }

  async switchTab(sessionId: string, targetId: string): Promise<void> {
    await this.post('/api/tab/switch', { sessionId, targetId })
  }

  async closeTab(sessionId: string, targetId?: string): Promise<void> {
    await this.post('/api/tab/close', { sessionId, targetId })
  }

  // --------------------------------------------------------------------------
  // Site commands
  // --------------------------------------------------------------------------

  async drainEvents(
    sessionId: string,
    options: { peek?: boolean } = {},
  ): Promise<{ events: Array<Record<string, unknown>>; dropped: number }> {
    return this.post('/api/events/drain', { sessionId, peek: options.peek })
  }

  async setEventFilter(
    sessionId: string,
    pattern: string | null,
  ): Promise<{ filter: string | null; buffered: number }> {
    return this.post('/api/events/filter', { sessionId, pattern })
  }

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

}
