/**
 * Encapsulates ghost cursor lifecycle for recording sessions.
 *
 * DIFFERENCE FROM UPSTREAM PLAYWRITER: The fork adds page.onMouseAction as a native
 * Playwright API. Without the fork, ghost cursor is driven by injecting
 * client-side JavaScript that listens for mouse events directly in the page.
 * The enableGhostCursor/applyGhostCursorMouseAction functions handle this
 * by using page.evaluate() to inject cursor tracking code.
 *
 * For relay-level mouse action interception (pre-dispatch hooks), see the
 * relay server's Input.dispatchMouseEvent interception.
 */
import type { BrowserContext, Page } from 'playwright-core'
import { disableGhostCursor, enableGhostCursor, type GhostCursorClientOptions } from './ghost-cursor.js'
import { getSessionId } from './playwright-compat.js'

interface RecordingGhostCursorLogger {
  error: (...args: unknown[]) => void
}

interface RecordingTargetOptions {
  page?: Page
  sessionId?: string
}

export class RecordingGhostCursorController {
  private readonly cursorApplyQueueByPage = new WeakMap<Page, Promise<void>>()
  private readonly logger: RecordingGhostCursorLogger

  constructor(options: { logger: RecordingGhostCursorLogger }) {
    this.logger = options.logger
  }

  resolveRecordingTargetPage(options: {
    context: BrowserContext
    defaultPage: Page
    target?: RecordingTargetOptions
  }): Page {
    const { context, defaultPage, target } = options

    if (target?.page) {
      return target.page
    }

    if (target?.sessionId) {
      const pageForSession = context.pages().find((candidatePage) => {
        return getSessionId(candidatePage) === target.sessionId
      })

      if (pageForSession) {
        return pageForSession
      }
    }

    return defaultPage
  }

  async enableForRecording(options: { page: Page }): Promise<void> {
    const { page } = options
    try {
      await enableGhostCursor({ page })
    } catch (error) {
      this.logger.error('[runbrowser] Failed to enable ghost cursor', error)
    }
  }

  async disableForRecording(options: { page: Page }): Promise<void> {
    const { page } = options
    this.cursorApplyQueueByPage.delete(page)
    try {
      await disableGhostCursor({ page })
    } catch (error) {
      this.logger.error('[runbrowser] Failed to disable ghost cursor', error)
    }
  }

  async show(options: { page: Page; cursorOptions?: GhostCursorClientOptions }): Promise<void> {
    const { page, cursorOptions } = options
    await enableGhostCursor({ page, cursorOptions })
  }

  async hide(options: { page: Page }): Promise<void> {
    const { page } = options
    await disableGhostCursor({ page })
  }
}
