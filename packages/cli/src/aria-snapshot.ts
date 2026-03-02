/**
 * Aria snapshot — re-exports from @runbrowser/core.
 */
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
} from '@runbrowser/core/aria-snapshot'
export type {
  AriaRef,
  AriaSnapshotResult,
  ScreenshotResult,
  AriaSnapshotNode,
} from '@runbrowser/core/aria-snapshot'
