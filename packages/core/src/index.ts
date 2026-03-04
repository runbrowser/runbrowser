/**
 * runbrowser-core — Shared core library for RunBrowser.
 *
 * Contains utilities shared by both CLI and MCP:
 * debugger, editor, ffmpeg, diff, scoped-fs, htmlrewrite, browser-config.
 */

// Re-export relay (so consumers can get everything from core)
export * from '@agmod/runbrowser-relay'

// CDP types (ICDPSession interface, no playwright dependency)
export type { ICDPSession } from './cdp-types.js'

// Editor & Debugger
export { Editor } from './editor.js'
export type { ReadResult, SearchMatch, EditResult } from './editor.js'
export { Debugger } from './debugger.js'
export type { BreakpointInfo, LocationInfo, EvaluateResult, ScriptInfo } from './debugger.js'

// FFmpeg utilities
export {
  concatenateVideos,
  speedUpSections,
  computeIdleSections,
  createDemoVideo,
  probeVideo,
  detectEncoder,
  INTERACTION_BUFFER_SECONDS,
} from './ffmpeg.js'
export type {
  InputFile,
  ConcatenateOptions,
  SpeedSection,
  SpeedUpSectionsOptions,
  VideoInfo,
  CreateDemoVideoOptions,
} from './ffmpeg.js'

// Diff utilities
export { createSmartDiff } from './diff-utils.js'

// HTML rewrite (internal utility)
export { formatHtmlForPrompt } from './htmlrewrite.js'
export type { FormatHtmlOptions } from './htmlrewrite.js'

// Scoped filesystem
export { ScopedFS } from './scoped-fs.js'

// Browser config
export { getBrowserExecutablePath } from './browser-config.js'

// Shared utilities (re-export from relay)
export {
  EXTENSION_IDS,
  parseRelayHost,
  getCdpUrl,
  LOG_FILE_PATH,
  LOG_CDP_FILE_PATH,
  VERSION,
  sleep,
} from './utils.js'
