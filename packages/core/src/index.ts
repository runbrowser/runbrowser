/**
 * @runbrowser/core — Shared core library for RunBrowser.
 *
 * Contains the executor, ffmpeg utilities, recording, snapshots,
 * and all browser automation primitives shared by both CLI and MCP.
 */

// Re-export relay (so consumers can get everything from core)
export * from '@runbrowser/relay'

// CDP session
export { getCDPSessionForPage, PlaywrightCDPSessionAdapter } from './cdp-session.js'
export type { ICDPSession } from './cdp-session.js'

// Executor
export {
  PlaywrightExecutor,
  ExecutorManager,
  CodeExecutionTimeoutError,
  getAutoReturnExpression,
  shouldAutoReturn,
  wrapCode,
} from './executor.js'
export type {
  ExecuteResult,
  ExecutorLogger,
  CdpConfig,
  SessionMetadata,
  ExecutorOptions,
  SnapshotFormat,
} from './executor.js'

// Editor & Debugger
export { Editor } from './editor.js'
export type { ReadResult, SearchMatch, EditResult } from './editor.js'
export { Debugger } from './debugger.js'
export type { BreakpointInfo, LocationInfo, EvaluateResult, ScriptInfo } from './debugger.js'

// Aria snapshot
export {
  getAriaSnapshot,
  showAriaRefLabels,
  hideAriaRefLabels,
  screenshotWithAccessibilityLabels,
  resizeImage,
  filterFullSnapshotTree,
  filterInteractiveSnapshotTree,
  buildRawSnapshotTree,
  buildSnapshotLines,
  finalizeSnapshotOutput,
} from './aria-snapshot.js'
export type { AriaRef, AriaSnapshotResult, ScreenshotResult, AriaSnapshotNode } from './aria-snapshot.js'

// Screen recording
export { startRecording, stopRecording, isRecording, cancelRecording, createRecordingApi, getChromeRestartCommand } from './screen-recording.js'
export type { StartRecordingOptions, StopRecordingOptions, RecordingState, ExecutionTimestamp } from './screen-recording.js'

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

// Styles
export { getStylesForLocator, formatStylesAsText } from './styles.js'
export type { StylesResult } from './styles.js'

// React source
export { getReactSource } from './react-source.js'
export type { ReactSourceLocation } from './react-source.js'

// Clean HTML & page markdown
export { getCleanHTML } from './clean-html.js'
export type { GetCleanHTMLOptions } from './clean-html.js'
export { getPageMarkdown } from './page-markdown.js'
export type { GetPageMarkdownOptions } from './page-markdown.js'

// Diff utilities
export { createSmartDiff } from './diff-utils.js'

// HTML rewrite (internal utility, used by clean-html)
export { formatHtmlForPrompt } from './htmlrewrite.js'
export type { FormatHtmlOptions } from './htmlrewrite.js'

// Scoped filesystem
export { ScopedFS } from './scoped-fs.js'

// Wait for page load
export { waitForPageLoad } from './wait-for-page-load.js'
export type { WaitForPageLoadOptions, WaitForPageLoadResult } from './wait-for-page-load.js'

// Cursor overlay
export { enableCursorOverlay, disableCursorOverlay, applyCursorOverlayMouseAction } from './cursor-overlay.js'
export type { CursorOverlayOptions } from './cursor-overlay.js'
export { RecordingCursorOverlayController } from './recording-cursor-overlay.js'

// Playwright compat
export { getTargetId, getSessionId, getFrameId, getSelector, isFrame } from './playwright-compat.js'
export type { MouseActionEvent } from './playwright-compat.js'

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
