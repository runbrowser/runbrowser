/**
 * HTTP API client for the relay server.
 *
 * Used by both CLI and MCP to interact with the relay server's API endpoints.
 * This is the single client library — no HTTP fetch logic should live in CLI or MCP.
 */

import { parseRelayHost } from './utils.js'
import { RELAY_PORT, type ExtensionStatus, ensureRelayServer, waitForConnectedExtensions, getExtensionStatus, getExtensionOutdatedWarning } from './client.js'

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
}
