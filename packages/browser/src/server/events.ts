/**
 * Buffered CDP events, per session.
 *
 * `cdp` sends commands and reads results. CDP is commands *and* events, and
 * without them a caller cannot wait on a navigation, a dialog, a download
 * finishing, or the network going quiet — it can only poll for an observable
 * side effect, which covers loads and misses the rest.
 *
 * The relay already receives every event the extension forwards. This keeps a
 * bounded per-session tail of them so a caller can drain what happened since it
 * last looked, rather than subscribing to a stream it has no way to hold open
 * between one CLI invocation and the next.
 *
 * Bounded on purpose: Network.* alone will produce thousands of events on a
 * busy page, and a buffer nobody drains must not grow without limit. When it
 * overflows the oldest go first and the drain says how many were lost, because
 * silently losing events is how a caller comes to trust a gap.
 */

import type { CDPEventBase } from './cdp-types.js'

export type BufferedEvent = {
  /** Monotonic within a buffer, so a caller can tell ordering and loss apart. */
  seq: number
  timestamp: number
  method: string
  sessionId?: string
  params?: unknown
}

export type DrainResult = {
  events: BufferedEvent[]
  /** Events discarded to stay within the cap since the last drain. */
  dropped: number
}

const DEFAULT_CAPACITY = 1000

export class EventBuffer {
  private events: BufferedEvent[] = []
  private nextSeq = 1
  private dropped = 0
  private methodFilter: RegExp | null = null

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  /**
   * Restrict what is retained. Most tasks want a handful of domains, and
   * filtering at the door is what keeps the cap meaningful — an unfiltered
   * buffer on a busy page is all Network.* and nothing a caller asked for.
   */
  setFilter(pattern: string | null): void {
    this.methodFilter = pattern ? new RegExp(pattern) : null
  }

  getFilter(): string | null {
    return this.methodFilter?.source ?? null
  }

  record(event: CDPEventBase): void {
    if (this.methodFilter && !this.methodFilter.test(event.method)) return

    this.events.push({
      seq: this.nextSeq++,
      timestamp: Date.now(),
      method: event.method,
      sessionId: event.sessionId,
      params: event.params,
    })

    while (this.events.length > this.capacity) {
      this.events.shift()
      this.dropped++
    }
  }

  /** Take everything buffered and reset. */
  drain(): DrainResult {
    const events = this.events
    const dropped = this.dropped
    this.events = []
    this.dropped = 0
    return { events, dropped }
  }

  /** Look without consuming, for a caller polling toward a condition. */
  peek(): DrainResult {
    return { events: [...this.events], dropped: this.dropped }
  }

  clear(): void {
    this.events = []
    this.dropped = 0
  }

  get size(): number {
    return this.events.length
  }
}

/**
 * One buffer per session, created on first use.
 *
 * Keyed by session rather than by tab: two agents watching one tab each want
 * their own copy of what happened, and a drain by one must not blind the other.
 */
export class EventBufferRegistry {
  private buffers = new Map<string, EventBuffer>()

  get(sessionId: string): EventBuffer {
    let buffer = this.buffers.get(sessionId)
    if (!buffer) {
      buffer = new EventBuffer()
      this.buffers.set(sessionId, buffer)
    }
    return buffer
  }

  /** Fan an event out to every session watching. */
  record(event: CDPEventBase): void {
    for (const buffer of this.buffers.values()) buffer.record(event)
  }

  delete(sessionId: string): boolean {
    return this.buffers.delete(sessionId)
  }

  get sessionIds(): string[] {
    return [...this.buffers.keys()]
  }
}
