/**
 * CDP-based screenshot capture.
 */

export type SendCDP = (method: string, params?: unknown) => Promise<unknown>

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
