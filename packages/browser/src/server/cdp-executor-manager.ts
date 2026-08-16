/**
 * CDPExecutorManager - Manages CDPExecutor instances keyed by session ID.
 * Implements ExecutorManagerLike to replace the injected executorManagerFactory pattern.
 * The relay server can now create executors natively without external factories.
 */

import type { ExecutorManagerLike } from './server.js'
import type { SessionMetadata } from './state.js'
import { CDPExecutor, type SendToExtension, type GetExtensionEntry, type RegisterTarget } from './cdp-executor.js'

export interface CDPExecutorManagerOptions {
  sendToExtension: SendToExtension
  getExtensionEntry: GetExtensionEntry
  registerTarget?: RegisterTarget
  logger?: { log(...args: any[]): void; error(...args: any[]): void }
}

export class CDPExecutorManager implements ExecutorManagerLike {
  private executors: Map<string, CDPExecutor> = new Map()
  private sendToExtension: SendToExtension
  private getExtensionEntry: GetExtensionEntry
  private registerTarget?: RegisterTarget
  private logger?: { log(...args: any[]): void; error(...args: any[]): void }

  constructor(options: CDPExecutorManagerOptions) {
    this.sendToExtension = options.sendToExtension
    this.getExtensionEntry = options.getExtensionEntry
    this.registerTarget = options.registerTarget
    this.logger = options.logger
  }

  getSession(sessionId: string): CDPExecutor | undefined {
    return this.executors.get(sessionId)
  }

  getExecutor(options: {
    sessionId: string
    cwd?: string
    sessionMetadata?: SessionMetadata
  }): CDPExecutor {
    const existing = this.executors.get(options.sessionId)
    if (existing) return existing

    const executor = new CDPExecutor({
      extensionStableKey: options.sessionMetadata?.extensionId || null,
      sessionMetadata: {
        extensionId: options.sessionMetadata?.extensionId || null,
        browser: options.sessionMetadata?.browser || null,
        profile: options.sessionMetadata?.profile || null,
      },
      sendToExtension: this.sendToExtension,
      getExtensionEntry: this.getExtensionEntry,
      registerTarget: this.registerTarget,
      logger: this.logger,
    })

    this.executors.set(options.sessionId, executor)
    this.logger?.log(`CDPExecutorManager: created executor for session ${options.sessionId}`)
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
        extensionId: meta.extensionId,
      }
    })
  }

  deleteExecutor(sessionId: string): boolean {
    return this.executors.delete(sessionId)
  }
}
