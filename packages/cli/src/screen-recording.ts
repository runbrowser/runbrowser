/**
 * Screen recording — re-exports from @runbrowser/core.
 */
export {
  startRecording,
  stopRecording,
  isRecording,
  cancelRecording,
  createRecordingApi,
  getChromeRestartCommand,
} from '@runbrowser/core/screen-recording'
export type {
  StartRecordingOptions,
  StopRecordingOptions,
  RecordingState,
  ExecutionTimestamp,
} from '@runbrowser/core/screen-recording'
