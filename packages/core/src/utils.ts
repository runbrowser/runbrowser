/**
 * Shared utilities — re-exported from @runbrowser/relay.
 *
 * The canonical source lives in the relay-server package.
 * This module re-exports everything so existing internal CLI imports
 * (e.g., `from './utils.js'`) keep working without changes.
 */
export {
  EXTENSION_IDS,
  parseRelayHost,
  getCdpUrl,
  LOG_FILE_PATH,
  LOG_CDP_FILE_PATH,
  VERSION,
  sleep,
} from '@runbrowser/relay/utils'
