/**
 * CDPExecutorManager - Manages CDPExecutor instances keyed by session ID.
 *
 * Each session gets its own CDPExecutor that connects directly to Chrome's
 * CDP WebSocket endpoint (no extension required).
 */

import type { ExecutorManagerLike } from './server.js'
import type { SessionMetadata } from './state.js'
import { CDPExecutor, type CDPExecutorOptions } from './cdp-executor.js'

export interface CDPExecutorManagerOptions {
  /** Default CDP WebSocket URL if not provided per-session */
  defaultCdpUrl?: string
  logger?: { log(...args: any[]): void; error(...args: any[]): void }
}

export class CDPExecutorManager implements ExecutorManagerLike {
  private executors: Map<string, CDPExecutor> = new Map()
  private defaultCdpUrl?: string
  private logger?: { log(...args: any[]): void; error(...args: any[]): void }

  constructor(options: CDPExecutorManagerOptions) {
    this.defaultCdpUrl = options.defaultCdpUrl
    this.logger = options.logger
  }

  getSession(sessionId: string): CDPExecutor | undefined {
    return this.executors.get(sessionId)
  }

  getExecutor(options: {
    sessionId: string
    cwd?: string
    cdpUrl?: string
    sessionMetadata?: SessionMetadata
  }): CDPExecutor {
    const existing = this.executors.get(options.sessionId)
    if (existing) return existing

    const cdpUrl = options.cdpUrl || this.defaultCdpUrl
    if (!cdpUrl) {
      throw new Error('No CDP WebSocket URL provided. Enable Chrome debugging first.')
    }

    const executor = new CDPExecutor({
      cdpUrl,
      sessionMetadata: {
        browser: options.sessionMetadata?.browser || null,
        profile: options.sessionMetadata?.profile || null,
      },
      logger: this.logger,
    })

    this.executors.set(options.sessionId, executor)
    this.logger?.log(`CDPExecutorManager: created executor for session ${options.sessionId} → ${cdpUrl}`)
    return executor
  }

  listSessions(): Array<SessionMetadata & { id: string; stateKeys: string[] }> {
    return Array.from(this.executors.entries()).map(([id, executor]) => {
      const meta = executor.getSessionMetadata()
      return {
        id,
        stateKeys: [],
        browser: meta.browser,
        profile: meta.profile,
      }
    })
  }

  async deleteExecutor(sessionId: string): Promise<boolean> {
    const executor = this.executors.get(sessionId)
    if (!executor) return false
    await executor.dispose()
    return this.executors.delete(sessionId)
  }
}
