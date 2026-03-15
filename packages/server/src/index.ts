/**
 * runbrowser-server — CDP server for RunBrowser.
 *
 * Bridges Chrome extension WebSocket connections to Playwright CDP clients.
 * This package provides the core relay server functionality, shared types,
 * client utilities, and logging.
 */

// Core server
export { startRunBrowserCDPRelayServer } from './server.js'
export type {
  RelayServer,
  ExecutorManagerLike,
  ExecutorLike,
} from './server.js'

// CDP Executor (replaces PlaywrightExecutor)
export { CDPExecutor } from './cdp-executor.js'
export type { CDPExecutorOptions, SendToExtension, GetExtensionEntry } from './cdp-executor.js'
export { CDPExecutorManager } from './cdp-executor-manager.js'
export type { CDPExecutorManagerOptions } from './cdp-executor-manager.js'

// State management
export {
  createRelayStore,
  findExtensionByStableKey,
  findExtensionIdByCdpSession,
  addExtension,
  removeExtension,
  addPlaywrightClient,
  removePlaywrightClient,
  rebindClientsToExtension,
  updateExtensionIO,
  addExtensionPendingRequest,
  removeExtensionPendingRequest,
  addTarget,
  removeTarget,
  removeTargetByCrash,
  updateTargetInfo,
  addFrameId,
  removeFrameId,
  updateTargetUrl,
} from './state.js'
export type {
  ConnectedTarget,
  ExtensionInfo,
  ExtensionPendingRequest,
  ExtensionEntry,
  PlaywrightClient,
  RelayState,
} from './state.js'

// Client utilities (for connecting to / managing relay server)
export {
  RELAY_PORT,
  ensureRelayServer,
  getRelayServerVersion,
  getExtensionStatus,
  getExtensionsStatus,
  waitForConnectedExtensions,
  compareVersions,
  getExtensionOutdatedWarning,
} from './client.js'
export type { ExtensionStatus, EnsureRelayServerOptions } from './client.js'

// API client (HTTP client for relay server endpoints — used by CLI and MCP)
export { RelayApiClient } from './api-client.js'
export type {
  RelayClientOptions,
  ExecuteResult,
  ResetResult,
  SessionInfo,
  SessionListEntry,
  StartRecordingApiResult,
  StopRecordingApiResult,
  RecordingStatusApiResult,
  CancelRecordingApiResult,
} from './api-client.js'

// Shared utilities
export {
  EXTENSION_IDS,
  VERSION,
  LOG_FILE_PATH,
  LOG_CDP_FILE_PATH,
  CONFIG_FILE_PATH,
  RUNBROWSER_DIR,
  readConfig,
  writeConfig,
  parseRelayHost,
  getCdpUrl,
  sleep,
} from './utils.js'
export type { RunBrowserConfig } from './utils.js'

// Logger
export { createFileLogger } from './create-logger.js'
export type { Logger } from './create-logger.js'

// CDP types
export type {
  CDPCommand,
  CDPResponse,
  CDPEvent,
  CDPCommandFor,
  CDPResponseFor,
  CDPEventFor,
  CDPResponseBase,
  CDPEventBase,
  CDPMessage,
  CDPCommandSource,
  RelayServerEvents,
  Protocol,
  ProtocolMapping,
} from './cdp-types.js'

// CDP logging
export { createCdpLogger } from './cdp-log.js'
export type { CdpLogEntry, CdpLogger } from './cdp-log.js'

// Extension protocol types
export type {
  ExtensionCommandMessage,
  ExtensionResponseMessage,
  ExtensionEventMessage,
  ExtensionLogMessage,
  ExtensionPongMessage,
  ExtensionMessage,
  StartRecordingParams,
  StartRecordingBody,
  StopRecordingParams,
  IsRecordingParams,
  CancelRecordingParams,
  StartRecordingResult,
  StopRecordingResult,
  IsRecordingResult,
  CancelRecordingResult,
  RecordingDataMessage,
  RecordingCancelledMessage,
} from './protocol.js'

// Recording relay
export { RecordingRelay } from './recording.js'
export type { ActiveRecording } from './recording.js'

// Port management
export { killPortProcess, getListeningPidsForPort, isPortInUse } from './kill-port.js'
export type { KillPortSignal } from './kill-port.js'


