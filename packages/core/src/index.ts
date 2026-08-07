/**
 * runbrowser-core — Shared core library for RunBrowser.
 *
 * Contains utilities shared by both CLI and MCP:
 * debugger, editor, ffmpeg, diff, scoped-fs, htmlrewrite, browser-config.
 */

// Re-export relay (so consumers can get everything from core)
export * from '@jiweiyuan/runbrowser-server'

// CDP types (ICDPSession interface, no playwright dependency)
export type { ICDPSession } from './cdp-types.js'

// Editor & Debugger
export { Editor } from './editor.js'
export type { ReadResult, SearchMatch, EditResult } from './editor.js'
export { Debugger } from './debugger.js'
export type { BreakpointInfo, LocationInfo, EvaluateResult, ScriptInfo } from './debugger.js'

// HTML rewrite (internal utility)
export { formatHtmlForPrompt } from './htmlrewrite.js'
export type { FormatHtmlOptions } from './htmlrewrite.js'

// Scoped filesystem
export { ScopedFS } from './scoped-fs.js'

// Browser config
export { getBrowserExecutablePath } from './browser-config.js'

// Chrome discovery (direct CDP mode)
export {
  discoverChromeInstances,
  resolveDirectInput,
  probePort,
} from './chrome-discovery.js'
export type { DiscoveredInstance } from './chrome-discovery.js'

// Shared utilities (re-export from relay)
export {
  parseRelayHost,
  getCdpUrl,
  LOG_FILE_PATH,
  LOG_CDP_FILE_PATH,
  VERSION,
  sleep,
} from './utils.js'
