import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import packageJson from '../../package.json' with { type: 'json' }

// RunBrowser extension IDs - used for validation and Chrome flag commands
// NOTE: These are the same extension IDs as the original playwriter project since we share the extension.
/**
 * Extension IDs the relay will accept a connection from.
 *
 * The previous "production" entry here was playwriter's Chrome Web Store ID,
 * inherited when this project forked from it. Accepting it meant another
 * product's extension could drive this relay — and since both defaulted to the
 * same port, that was not hypothetical. It is removed; this project has no
 * published extension yet.
 *
 * Loading the extension unpacked gives it a random ID unless manifest.json
 * carries a `key`, so RUNBROWSER_EXTENSION_ID lets a developer allow the
 * ID Chrome assigned them without editing source.
 */
export const EXTENSION_IDS = [
  'pebbngnfojnignonigcnkdilknapkgid', // Dev build
  ...(process.env.RUNBROWSER_EXTENSION_ID
    ? [process.env.RUNBROWSER_EXTENSION_ID]
    : []),
]

/**
 * Parse a relay host string into HTTP and WebSocket base URLs.
 * Supports both plain hostnames (appends port) and full URLs (uses as-is).
 *
 * Examples:
 *   "192.168.1.10"                        → http://192.168.1.10:8790, ws://192.168.1.10:8790
 *   "https://my-machine-tunnel.traforo.dev" → https://my-machine-tunnel.traforo.dev, wss://my-machine-tunnel.traforo.dev
 */
export function parseRelayHost(host: string, port: number = 8790): { httpBaseUrl: string; wsBaseUrl: string } {
  if (host.startsWith('https://') || host.startsWith('http://')) {
    const url = new URL(host)
    const httpBaseUrl = url.origin
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsBaseUrl = `${wsProtocol}//${url.host}`
    return { httpBaseUrl, wsBaseUrl }
  }
  return {
    httpBaseUrl: `http://${host}:${port}`,
    wsBaseUrl: `ws://${host}:${port}`,
  }
}

export function getCdpUrl({
  port = 8790,
  host = '127.0.0.1',
  token,
  extensionId,
}: {
  port?: number
  host?: string
  token?: string
  extensionId?: string | null
} = {}) {
  const id = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}`
  const params = new URLSearchParams()
  if (token) {
    params.set('token', token)
  }
  if (extensionId) {
    params.set('extensionId', extensionId)
  }
  const queryString = params.toString()
  const suffix = queryString ? `?${queryString}` : ''
  const { wsBaseUrl } = parseRelayHost(host, port)
  return `${wsBaseUrl}/cdp/${id}${suffix}`
}

// State directory, nested under termio's own so the browser layer does not
// claim a second top-level dotfolder. Per-OS-user, which avoids permission
// errors on shared machines.
export const RUNBROWSER_DIR =
  process.env.RUNBROWSER_DIR || path.join(os.homedir(), '.runbrowser')


const LOG_BASE_DIR = RUNBROWSER_DIR
export const LOG_FILE_PATH =
  process.env.RUNBROWSER_LOG_FILE_PATH || path.join(LOG_BASE_DIR, 'relay-server.log')
export const LOG_CDP_FILE_PATH =
  process.env.RUNBROWSER_CDP_LOG_FILE_PATH || path.join(path.dirname(LOG_FILE_PATH), 'cdp.jsonl')
export const CONFIG_FILE_PATH = path.join(RUNBROWSER_DIR, 'config.json')

export interface RunBrowserConfig {
  token?: string
  host?: string
  /** Chrome profile directory name (e.g. "Default", "Profile 11") */
  profile?: string
}

export function readConfig(): RunBrowserConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8')
    return JSON.parse(raw) as RunBrowserConfig
  } catch {
    return {}
  }
}

export function writeConfig(config: RunBrowserConfig): void {
  fs.mkdirSync(RUNBROWSER_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

// Imported rather than read: a compiled binary has no package.json on disk, and
// reading one at module load took every command down with it.
export const VERSION = packageJson.version as string

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

