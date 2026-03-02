/**
 * Executor — re-exports from @runbrowser/core.
 *
 * The PlaywrightExecutor and related types now live in @runbrowser/core.
 * This module re-exports them for backward compatibility with
 * `import { ... } from 'runbrowser/executor'`.
 */
export {
  PlaywrightExecutor,
  ExecutorManager,
  CodeExecutionTimeoutError,
  getAutoReturnExpression,
  shouldAutoReturn,
  wrapCode,
} from '@runbrowser/core/executor'
export type {
  ExecuteResult,
  ExecutorLogger,
  CdpConfig,
  SessionMetadata,
  ExecutorOptions,
  SnapshotFormat,
} from '@runbrowser/core/executor'
