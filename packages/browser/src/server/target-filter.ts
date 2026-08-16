/**
 * Target filtering — determines which CDP targets should be exposed to clients.
 */

import type { Protocol } from './cdp-types.js'
import { EXTENSION_IDS } from './utils.js'

/**
 * Checks if a target should be filtered out (not exposed to Playwright).
 * Filters extension pages, service workers, and other restricted targets,
 * but allows our own extension pages for debugging purposes.
 */
export function isRestrictedTarget(targetInfo: Protocol.Target.TargetInfo): boolean {
  const { url, type } = targetInfo

  // Filter by type - allow pages and iframe targets (OOPIFs)
  if (type !== 'page' && type !== 'iframe') {
    return true
  }

  // Filter by URL - block extension and chrome internal pages
  if (!url) {
    return false
  }

  // Allow our own extension pages
  if (url.startsWith('chrome-extension://')) {
    const extensionId = url.replace('chrome-extension://', '').split('/')[0]
    if (EXTENSION_IDS.includes(extensionId)) {
      return false
    }
    return true
  }

  // Block other restricted URLs
  const blockedPrefixes = ['chrome://', 'devtools://', 'edge://']
  return blockedPrefixes.some((prefix) => url.startsWith(prefix))
}
