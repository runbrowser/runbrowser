/**
 * ServerContext — shared dependencies for route handlers.
 *
 * Simplified for direct CDP mode (no extension).
 */

import type { EventEmitter } from 'node:events'
import type { StoreApi } from 'zustand/vanilla'
import type { CdpLogEntry } from './cdp-log.js'
import type { CDPExecutor } from './cdp-executor.js'
import type { CDPExecutorManager } from './cdp-executor-manager.js'

import * as relayState from './state.js'
import pc from 'picocolors'

// ============================================================================
// Types
// ============================================================================

export type Logger = {
  log(...args: any[]): void
  error(...args: any[]): void
}

export type ServerContext = {
  store: StoreApi<relayState.RelayState>
  emitter: EventEmitter
  logger?: Logger
  token?: string
  host: string
  port: number

  // CDP logging
  logCdpJson: (entry: CdpLogEntry) => void

  // Session / Executor
  executorManager: CDPExecutorManager
  getCDPExecutor: (sessionId: string) => CDPExecutor | null
  nextSessionNumber: { value: number }

  // Utility
  normalizeSessionId: (value: string | number | null | undefined) => string | null
}

// ============================================================================
// Logging helpers
// ============================================================================

const NOISY_CDP_EVENTS = new Set([
  'Network.requestWillBeSentExtraInfo',
  'Network.responseReceived',
  'Network.responseReceivedExtraInfo',
  'Network.dataReceived',
  'Network.requestWillBeSent',
  'Network.loadingFinished',
])

export function logCdpMessage(
  logger: Logger | undefined,
  {
    direction,
    clientId,
    method,
    sessionId,
    params,
    id,
    source,
  }: {
    direction: 'to-chrome' | 'from-chrome' | 'to-playwright' | 'from-playwright'
    clientId?: string
    method: string
    sessionId?: string
    params?: any
    id?: number
    source?: 'direct' | 'server'
  },
) {
  if (NOISY_CDP_EVENTS.has(method)) {
    return
  }

  const details: string[] = []
  if (id !== undefined) details.push(`id=${id}`)
  if (sessionId) details.push(`sessionId=${sessionId}`)
  if (params) {
    if (params.targetId) details.push(`targetId=${params.targetId}`)
    if (params.targetInfo?.targetId) details.push(`targetId=${params.targetInfo.targetId}`)
  }

  const detailsStr = details.length > 0 ? ` ${pc.gray(details.join(', '))}` : ''

  if (direction === 'from-chrome') {
    logger?.log(pc.yellow('← Chrome:'), method + detailsStr)
  } else if (direction === 'to-chrome') {
    logger?.log(pc.green('→ Chrome:'), method + detailsStr)
  } else if (direction === 'from-playwright') {
    const clientLabel = clientId ? pc.blue(`[${clientId}]`) : ''
    logger?.log(pc.cyan('← Playwright'), clientLabel + ':', method + detailsStr)
  } else if (direction === 'to-playwright') {
    const color = source === 'server' ? pc.magenta : pc.green
    const sourceLabel = source === 'server' ? pc.gray(' (server-generated)') : ''
    const clientLabel = clientId ? pc.blue(`[${clientId}]`) : pc.blue('[ALL]')
    logger?.log(color('→ Playwright'), clientLabel + ':', method + detailsStr + sourceLabel)
  }
}
