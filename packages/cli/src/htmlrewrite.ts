/**
 * HTML rewrite — re-exports from @runbrowser/core.
 * Note: internal utility, not exported from core index. 
 * Consumers should use getCleanHTML instead.
 */
// Keep the file for backward compat with tests that import it directly
export { formatHtmlForPrompt } from '@runbrowser/core'
export type { FormatHtmlOptions } from '@runbrowser/core'
