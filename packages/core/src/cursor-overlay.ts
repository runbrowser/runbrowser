/**
 * Node-side cursor overlay helpers.
 * Injects the browser bundle and forwards mouse action events to the page overlay.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright-core'
import type { MouseActionEvent } from './playwright-compat.js'

export interface CursorOverlayOptions {
  style?: 'minimal' | 'dot' | 'screenstudio'
  color?: string
  size?: number
  zIndex?: number
  easing?: string
  minDurationMs?: number
  maxDurationMs?: number
  speedPxPerMs?: number
}

interface CursorOverlayBrowserApi {
  enable: (options?: CursorOverlayOptions) => void
  disable: () => void
  applyMouseAction: (event: MouseActionEvent) => void
}

let cursorOverlayCode: string | null = null

function getCursorOverlayCode(): string {
  if (cursorOverlayCode) {
    return cursorOverlayCode
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const bundlePath = path.join(currentDir, '..', 'dist', 'cursor-overlay-client.js')
  cursorOverlayCode = fs.readFileSync(bundlePath, 'utf-8')
  return cursorOverlayCode
}

async function ensureCursorOverlayInjected(options: { page: Page }): Promise<void> {
  const { page } = options
  const hasCursorOverlay = await page.evaluate(() => {
    return Boolean((globalThis as { __runbrowserCursorOverlay?: unknown }).__runbrowserCursorOverlay)
  })

  if (hasCursorOverlay) {
    return
  }

  const code = getCursorOverlayCode()
  await page.evaluate(code)
}

export async function enableCursorOverlay(options: {
  page: Page
  cursorOptions?: CursorOverlayOptions
}): Promise<void> {
  const { page, cursorOptions } = options
  await ensureCursorOverlayInjected({ page })

  await page.evaluate(
    ({ optionsFromNode }) => {
      const api = (globalThis as { __runbrowserCursorOverlay?: CursorOverlayBrowserApi }).__runbrowserCursorOverlay
      api?.enable(optionsFromNode)
    },
    { optionsFromNode: cursorOptions },
  )
}

export async function disableCursorOverlay(options: { page: Page }): Promise<void> {
  const { page } = options
  await page.evaluate(() => {
    const api = (globalThis as { __runbrowserCursorOverlay?: CursorOverlayBrowserApi }).__runbrowserCursorOverlay
    api?.disable()
  })
}

export async function applyCursorOverlayMouseAction(options: {
  page: Page
  event: MouseActionEvent
}): Promise<void> {
  const { page, event } = options

  const applied = await page.evaluate(
    ({ serializedEvent }) => {
      const api = (globalThis as { __runbrowserCursorOverlay?: CursorOverlayBrowserApi }).__runbrowserCursorOverlay
      if (!api) {
        return false
      }

      api.applyMouseAction(serializedEvent)
      return true
    },
    { serializedEvent: event },
  )

  if (applied) {
    return
  }

  await ensureCursorOverlayInjected({ page })
  await page.evaluate(
    ({ serializedEvent }) => {
      const api = (globalThis as { __runbrowserCursorOverlay?: CursorOverlayBrowserApi }).__runbrowserCursorOverlay
      api?.applyMouseAction(serializedEvent)
    },
    { serializedEvent: event },
  )
}
