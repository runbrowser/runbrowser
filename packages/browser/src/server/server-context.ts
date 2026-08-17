/**
 * ServerContext — shared dependencies for route handlers.
 *
 * Replaces closure-based state sharing in server.ts.
 * Created once, passed to all route registration functions.
 */

import type { EventEmitter } from 'node:events'
import type { StoreApi } from 'zustand/vanilla'
import type { WSContext } from 'hono/ws'
import type { Protocol } from './cdp-types.js'
import type { CDPCommand, CDPResponseBase, CDPEventBase, RelayServerEvents } from './cdp-types.js'
import type { CdpLogEntry, CdpLogger } from './cdp-log.js'
import type {
  ExtensionMessage,
} from './protocol.js'
import type { CDPExecutor } from './cdp-executor.js'
import type { CDPExecutorManager } from './cdp-executor-manager.js'
import type { EventBufferRegistry } from './events.js'

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

  // Extension communication
  sendToExtension: SendToExtensionFn
  sendToPlaywright: SendToPlaywrightFn
  getExtensionConnection: GetExtensionConnectionFn

  // CDP routing
  routeCdpCommand: RouteCdpCommandFn

  // Session / Executor
  executorManager: CDPExecutorManager
  getCDPExecutor: (sessionId: string) => CDPExecutor | null
  nextSessionNumber: { value: number }

  /** Buffered CDP events, so a caller can read what happened between calls. */
  eventBuffers: EventBufferRegistry


  // Extension helpers
  buildStableExtensionKey: (info: relayState.ExtensionInfo, connectionId: string) => string
  startExtensionPing: (extensionId: string) => void
  stopExtensionPing: (extensionId: string) => void
  getPageTargetForFrameId: (params: {
    extensionState: relayState.ExtensionEntry
    frameId: string
  }) => relayState.ConnectedTarget | undefined




  // Utility
  normalizeSessionId: (value: string | number | null | undefined) => string | null
}

export type SendToExtensionFn = (params: {
  extensionId?: string | null
  method: string
  params?: unknown
  timeout?: number
}) => Promise<unknown>

export type SendToPlaywrightFn = (params: {
  message: CDPResponseBase | CDPEventBase
  clientId?: string
  source?: 'extension' | 'server'
  extensionId?: string | null
}) => void

export type GetExtensionConnectionFn = (
  extensionId?: string | null,
  options?: { allowFallback?: boolean },
) => relayState.ExtensionEntry | null

export type RouteCdpCommandFn = (params: {
  extensionId: string | null
  method: CDPCommand['method'] | (string & {})
  params: CDPCommand['params']
  sessionId?: CDPCommand['sessionId']
  source?: CDPCommand['source']
}) => Promise<unknown>

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
    direction: 'to-playwright' | 'from-playwright' | 'from-extension'
    clientId?: string
    method: string
    sessionId?: string
    params?: any
    id?: number
    source?: 'extension' | 'server'
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
    if (params.sessionId && params.sessionId !== sessionId) details.push(`sessionId=${params.sessionId}`)
  }

  const detailsStr = details.length > 0 ? ` ${pc.gray(details.join(', '))}` : ''

  if (direction === 'from-playwright') {
    const clientLabel = clientId ? pc.blue(`[${clientId}]`) : ''
    logger?.log(pc.cyan('← Playwright'), clientLabel + ':', method + detailsStr)
  } else if (direction === 'from-extension') {
    logger?.log(pc.yellow('← Extension:'), method + detailsStr)
  } else if (direction === 'to-playwright') {
    const color = source === 'server' ? pc.magenta : pc.green
    const sourceLabel = source === 'server' ? pc.gray(' (server-generated)') : ''
    const clientLabel = clientId ? pc.blue(`[${clientId}]`) : pc.blue('[ALL]')
    logger?.log(color('→ Playwright'), clientLabel + ':', method + detailsStr + sourceLabel)
  }
}
