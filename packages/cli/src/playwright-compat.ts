/**
 * Compatibility layer that provides the same APIs as the @xmorse/playwright-core
 * fork, but using standard playwright-core + private property access.
 *
 * This file is the ONLY place in the codebase that accesses Playwright internals.
 * If Playwright renames internal properties in a future version, only this file
 * needs updating.
 *
 * Replaces these fork additions:
 *   page.targetId()               → getTargetId(page)
 *   page.sessionId()              → getSessionId(page)
 *   frame.frameId()               → getFrameId(frame)
 *   locator.selector()            → getSelector(locator)
 *   context.getExistingCDPSession → not needed (RelayCDPSession bypasses it)
 *   page.onMouseAction            → relay-level interception (see relay server)
 *   MouseActionEvent type         → locally defined below
 */
import type { Page, Frame, Locator } from 'playwright-core'

/**
 * Get the CDP target ID for a page.
 * Internal path: page._delegate._targetId (CRPage stores targetId)
 */
export function getTargetId(page: Page): string | undefined {
  try {
    const delegate = (page as unknown as Record<string, unknown>)._delegate as Record<string, unknown> | undefined
    return delegate?._targetId as string | undefined
  } catch {
    return undefined
  }
}

/**
 * Get the CDP session ID for a page.
 * Internal path: page._delegate._mainFrameSession._client._sessionId
 * In the relay, this returns "pw-tab-XXX" or "rb-tab-XXX" session IDs.
 */
export function getSessionId(page: Page): string | undefined {
  try {
    const delegate = (page as unknown as Record<string, unknown>)._delegate as Record<string, unknown> | undefined
    const mainFrameSession = delegate?._mainFrameSession as Record<string, unknown> | undefined
    const client = mainFrameSession?._client as Record<string, unknown> | undefined
    return client?._sessionId as string | undefined
  } catch {
    return undefined
  }
}

/**
 * Get the CDP frame ID for a frame.
 * Internal path: frame._id
 */
export function getFrameId(frame: Frame): string | undefined {
  try {
    return (frame as unknown as Record<string, unknown>)._id as string | undefined
  } catch {
    return undefined
  }
}

/**
 * Get the internal selector string from a Locator.
 * Internal path: locator._selector
 */
export function getSelector(locator: Locator): string {
  return (locator as unknown as Record<string, unknown>)._selector as string ?? ''
}

/**
 * Check if a frame-like object has frameId (real Frame vs FrameLocator).
 * Replaces `typeof (frame as Frame).frameId === 'function'` check.
 */
export function isFrame(frameOrLocator: unknown): frameOrLocator is Frame {
  // Real Frames have _id, FrameLocators don't
  return typeof (frameOrLocator as unknown as Record<string, unknown>)?._id === 'string'
}

/**
 * Mouse action event type — originally defined in the Playwright fork's
 * page.ts and exported as MouseActionEvent. We define it locally since
 * standard playwright-core doesn't have it.
 */
export type MouseActionEvent = {
  type: 'move' | 'down' | 'up' | 'wheel'
  x: number
  y: number
  button: 'left' | 'right' | 'middle' | 'none'
}
