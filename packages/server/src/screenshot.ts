/**
 * CDP-based screenshot capture.
 */

import type { SendCDP } from './commands.js'

/**
 * Capture a screenshot of the current page via CDP.
 * Returns base64-encoded PNG data.
 */
export async function captureScreenshot(sendCDP: SendCDP): Promise<string> {
  const result = (await sendCDP('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 80,
  })) as { data: string }
  return result.data
}
