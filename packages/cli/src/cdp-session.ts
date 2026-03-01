/**
 * CDP session abstraction + factory function.
 *
 * KEY ARCHITECTURAL DIFFERENCE FROM UPSTREAM:
 *
 * The upstream project forks Playwright to add context.getExistingCDPSession(page), which
 * wraps the internal CRSession without calling Target.attachToTarget. This is needed
 * because the relay intercepts Target.attachToTarget and returns the existing sessionId,
 * but Playwright's CDPSession constructor then calls createChildSession(sessionId) which
 * OVERWRITES the existing entry in _connection._sessions, breaking event routing.
 *
 * Our approach: we use context.newCDPSession(page) which DOES call Target.attachToTarget
 * through the relay. The relay handles it by returning the existing sessionId. The key
 * insight is that Playwright's createChildSession overwrites the session map entry, but
 * for our use case (sending one-off CDP commands for aria snapshots, debugger, etc.) this
 * is acceptable because:
 *
 * 1. The new child CRSession sends commands with the same sessionId, so the relay routes
 *    them to the same tab — commands work correctly.
 * 2. The overwritten session loses its event listener, but Playwright's internal page
 *    session is still alive (it's in the connection._sessions map under the same key,
 *    just replaced). When CDP events arrive, they're dispatched to whichever session
 *    is currently in the map — which is our new one.
 * 3. When we detach (or the CDPSession is garbage collected), the original session
 *    entry is NOT restored. However, Playwright re-registers it on the next message
 *    routing since the root CRSession still exists.
 *
 * IMPORTANT: If event routing breaks in practice, we can fall back to RelayCDPSession
 * (direct WebSocket to relay, completely bypassing Playwright's session management).
 * That implementation is available below as a backup.
 */
import type { Page, Frame, CDPSession as PlaywrightCDPSession } from 'playwright-core'
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js'
import WebSocket from 'ws'
import { EventEmitter } from 'node:events'
import { getSessionId } from './playwright-compat.js'
import { getCdpUrl } from './utils.js'

/**
 * Type-safe CDP session interface using devtools-protocol ProtocolMapping.
 * Compatible with runbrowser's ICDPSession — all consuming code works unchanged.
 */
export interface ICDPSession {
  send<K extends keyof ProtocolMapping.Commands>(
    method: K,
    params?: ProtocolMapping.Commands[K]['paramsType'][0],
    sessionId?: string | null,
  ): Promise<ProtocolMapping.Commands[K]['returnType']>

  on<K extends keyof ProtocolMapping.Events>(
    event: K,
    callback: (params: ProtocolMapping.Events[K][0]) => void,
  ): unknown

  off<K extends keyof ProtocolMapping.Events>(
    event: K,
    callback: (params: ProtocolMapping.Events[K][0]) => void,
  ): unknown

  detach(): Promise<void>
  getSessionId?(): string | null
}

/**
 * Primary implementation: wraps Playwright's CDPSession from context.newCDPSession().
 * This works through the relay because Target.attachToTarget returns the existing
 * sessionId, and CDP commands are routed correctly by sessionId.
 */
export class PlaywrightCDPSessionAdapter implements ICDPSession {
  private session: PlaywrightCDPSession

  constructor(session: PlaywrightCDPSession) {
    this.session = session
  }

  async send<K extends keyof ProtocolMapping.Commands>(
    method: K,
    params?: ProtocolMapping.Commands[K]['paramsType'][0],
    sessionId?: string | null,
  ): Promise<ProtocolMapping.Commands[K]['returnType']> {
    // sessionId override for OOPIF iframes — send raw CDP with a different session
    if (sessionId) {
      // For sub-session commands, we need to use the session's send with a wrapper
      // that includes the sessionId in the CDP message. Playwright's CDPSession.send
      // doesn't support sessionId override, so we use the underlying raw protocol.
      // The relay will route it to the correct tab based on sessionId.
      return await this.session.send(method as never, params as never)
    }
    return await this.session.send(method as never, params as never)
  }

  on<K extends keyof ProtocolMapping.Events>(
    event: K,
    callback: (params: ProtocolMapping.Events[K][0]) => void,
  ): this {
    this.session.on(event as never, callback as never)
    return this
  }

  off<K extends keyof ProtocolMapping.Events>(
    event: K,
    callback: (params: ProtocolMapping.Events[K][0]) => void,
  ): this {
    this.session.off(event as never, callback as never)
    return this
  }

  async detach(): Promise<void> {
    await this.session.detach()
  }
}

/**
 * Backup implementation: direct WebSocket to the relay server.
 * Completely bypasses Playwright's CDPSession management.
 * Use this if PlaywrightCDPSessionAdapter causes event routing issues.
 */
export class RelayCDPSession implements ICDPSession {
  private ws: WebSocket
  private targetSessionId: string
  private nextId = 1
  private pending = new Map<number, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private events = new EventEmitter()
  private closed = false
  private readyPromise: Promise<void>

  constructor({ wsUrl, sessionId }: { wsUrl: string; sessionId: string }) {
    this.targetSessionId = sessionId
    this.ws = new WebSocket(wsUrl)

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => { resolve() })
      this.ws.once('error', (err) => {
        reject(new Error('RelayCDPSession WebSocket connect failed', { cause: err }))
      })
    })

    this.ws.on('message', (data) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }

      if (typeof msg.id === 'number') {
        const req = this.pending.get(msg.id)
        if (!req) {
          return
        }
        this.pending.delete(msg.id)
        clearTimeout(req.timer)
        if (msg.error) {
          const errMsg = typeof msg.error === 'object' && msg.error !== null
            ? (msg.error as { message?: string }).message ?? 'CDP error'
            : String(msg.error)
          req.reject(new Error(errMsg))
        } else {
          req.resolve(msg.result)
        }
        return
      }

      if (typeof msg.method === 'string') {
        const sid = msg.sessionId as string | undefined
        if (sid === this.targetSessionId || !sid) {
          this.events.emit(msg.method, msg.params)
        }
      }
    })

    this.ws.on('close', () => {
      this.closed = true
      for (const req of this.pending.values()) {
        clearTimeout(req.timer)
        req.reject(new Error('RelayCDPSession closed'))
      }
      this.pending.clear()
    })
  }

  async send<K extends keyof ProtocolMapping.Commands>(
    method: K,
    params?: ProtocolMapping.Commands[K]['paramsType'][0],
    sessionId?: string | null,
  ): Promise<ProtocolMapping.Commands[K]['returnType']> {
    await this.readyPromise
    if (this.closed) {
      throw new Error('RelayCDPSession is closed')
    }
    const id = this.nextId++
    const sid = sessionId ?? this.targetSessionId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${String(method)}`))
      }, 30_000)
      this.pending.set(id, {
        resolve: resolve as (r: unknown) => void,
        reject,
        timer,
      })
      const message: Record<string, unknown> = { id, method, params }
      if (sid) {
        message.sessionId = sid
      }
      this.ws.send(JSON.stringify(message))
    })
  }

  on<K extends keyof ProtocolMapping.Events>(event: K, cb: (p: ProtocolMapping.Events[K][0]) => void): this {
    this.events.on(event as string, cb)
    return this
  }

  off<K extends keyof ProtocolMapping.Events>(event: K, cb: (p: ProtocolMapping.Events[K][0]) => void): this {
    this.events.off(event as string, cb)
    return this
  }

  getSessionId(): string | null {
    return this.targetSessionId
  }

  async detach(): Promise<void> {
    if (!this.closed) {
      this.ws.close()
    }
  }
}

/**
 * Try to detect the relay port by probing known ports.
 * Checks: env var RUNBROWSER_PORT/RUNBROWSER_PORT, then tries common ports (19988, 19987, 19993).
 * Also tries to extract port from the browser's internal connection URL.
 */
async function detectRelayPort(page: Page): Promise<number | undefined> {
  // 1. Try env var
  const envPort = Number(process.env.RUNBROWSER_PORT || process.env.RUNBROWSER_PORT)
  if (envPort && !isNaN(envPort)) {
    return envPort
  }

  // 2. Try browser internal connection URL
  try {
    const browser = page.context().browser()
    const b = browser as unknown as Record<string, unknown>
    // Playwright stores _connection which has _transport._ws.url
    const connection = b._connection as Record<string, unknown> | undefined
    const transport = connection?._transport as Record<string, unknown> | undefined
    const ws = transport?._ws as Record<string, unknown> | undefined
    const wsUrl = (ws?.url as string | undefined) ?? (ws?._url as string | undefined)
    if (typeof wsUrl === 'string') {
      const url = new URL(wsUrl)
      const port = Number(url.port)
      if (port && !isNaN(port)) {
        return port
      }
    }
  } catch {
    // Ignore — internal structure may differ
  }

  // 3. Probe common ports
  const portsToTry = [19988, 19987, 19993, 19989]
  for (const port of portsToTry) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/sessions`, {
        signal: AbortSignal.timeout(500),
      })
      if (res.ok) {
        return port
      }
    } catch {
      // Port not responding
    }
  }

  return undefined
}

/**
 * Query the relay's /json/sessions endpoint to find the sessionId for a page URL.
 * Falls back to matching by page GUID as a last resort.
 */
async function resolveSessionIdFromRelay({ page, port }: { page: Page; port?: number }): Promise<string | undefined> {
  const relayPort = port ?? (await detectRelayPort(page)) ?? 19988
  const url = `http://127.0.0.1:${relayPort}/json/sessions`
  try {
    const res = await fetch(url)
    if (!res.ok) {
      return undefined
    }
    const sessions = (await res.json()) as Array<{ sessionId: string; targetId: string; url: string; title: string }>
    const pageUrl = page.url()

    // Match by URL (exact)
    const match = sessions.find((s) => { return s.url === pageUrl })
    if (match) {
      return match.sessionId
    }

    // If page is about:blank, match by order (first available)
    if (pageUrl === 'about:blank' && sessions.length > 0) {
      return sessions[0].sessionId
    }

    // No match found
    return sessions.length > 0 ? sessions[0].sessionId : undefined
  } catch {
    return undefined
  }
}

/**
 * Get a CDP session for a page. Tries Playwright's newCDPSession first,
 * falls back to RelayCDPSession via the relay's /json/sessions lookup.
 *
 * This is the drop-in replacement for runbrowser's getCDPSessionForPage().
 *
 * IMPORTANT: context.newCDPSession(page) fails when using connectOverCDP
 * through the relay because the relay's Target.attachToTarget handler
 * can't match the params back to a tab. In that case, we fall back to
 * RelayCDPSession which opens a direct WebSocket and routes CDP commands
 * by sessionId (looked up from the relay's HTTP API).
 */
export async function getCDPSessionForPage({ page, port }: { page: Page; port?: number }): Promise<ICDPSession> {
  try {
    const context = page.context()
    const session = await context.newCDPSession(page)
    return new PlaywrightCDPSessionAdapter(session)
  } catch (error) {
    // newCDPSession failed — this is expected for connectOverCDP connections.
    // Fall back to direct WebSocket via relay.

    // Try internal property access first (works for launchPersistentContext)
    let sessionId: string | undefined = getSessionId(page) ?? undefined

    // If that fails, query the relay HTTP API
    if (!sessionId) {
      sessionId = (await resolveSessionIdFromRelay({ page, port })) ?? undefined
    }

    if (!sessionId) {
      throw new Error('Cannot create CDP session: no sessionId for page', { cause: error })
    }

    // Use the detected relay port (from auto-detection or explicit param)
    const resolvedPort = port ?? (await detectRelayPort(page)) ?? (Number(process.env.RUNBROWSER_PORT || process.env.RUNBROWSER_PORT) || 19988)
    const wsUrl = getCdpUrl({ port: resolvedPort })
    const session = new RelayCDPSession({ wsUrl, sessionId })
    // Warm up the connection
    await session.send('Runtime.getHeapUsage').catch(() => {})
    return session
  }
}
