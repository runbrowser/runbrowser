/**
 * FFmpeg utilities — re-exports from @runbrowser/core.
 */
export {
  concatenateVideos,
  speedUpSections,
  computeIdleSections,
  createDemoVideo,
  probeVideo,
  detectEncoder,
  INTERACTION_BUFFER_SECONDS,
} from '@runbrowser/core/ffmpeg'
export type {
  InputFile,
  ConcatenateOptions,
  SpeedSection,
  SpeedUpSectionsOptions,
  VideoInfo,
  CreateDemoVideoOptions,
  ExecutionTimestamp,
} from '@runbrowser/core/ffmpeg'
