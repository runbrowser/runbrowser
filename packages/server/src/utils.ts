import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// RunBrowser extension IDs - used for validation and Chrome flag commands
// NOTE: These are the same extension IDs as the original playwriter project since we share the extension.
export const EXTENSION_IDS = [
  'jfeammnjpkecdekppnclgkkffahnhfhe', // Production (Chrome Web Store)
  'pebbngnfojnignonigcnkdilknapkgid', // Dev extension (stable ID from manifest key)
]

/**
 * Parse a relay host string into HTTP and WebSocket base URLs.
 * Supports both plain hostnames (appends port) and full URLs (uses as-is).
 *
 * Examples:
 *   "192.168.1.10"                        → http://192.168.1.10:19988, ws://192.168.1.10:19988
 *   "https://my-machine-tunnel.traforo.dev" → https://my-machine-tunnel.traforo.dev, wss://my-machine-tunnel.traforo.dev
 */
export function parseRelayHost(host: string, port: number = 19988): { httpBaseUrl: string; wsBaseUrl: string } {
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
  port = 19988,
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

// Use ~/.runbrowser for logs so each OS user gets their own dir (avoids permission errors on shared machines)
export const RUNBROWSER_DIR = path.join(os.homedir(), '.runbrowser')
const LOG_BASE_DIR = RUNBROWSER_DIR
export const LOG_FILE_PATH =
  process.env.RUNBROWSER_LOG_FILE_PATH || path.join(LOG_BASE_DIR, 'relay-server.log')
export const LOG_CDP_FILE_PATH =
  process.env.RUNBROWSER_CDP_LOG_FILE_PATH || path.join(path.dirname(LOG_FILE_PATH), 'cdp.jsonl')
export const CONFIG_FILE_PATH = path.join(RUNBROWSER_DIR, 'config.json')

export interface RunBrowserConfig {
  token?: string
  host?: string
  /** Credential broker configuration */
  credentials?: {
    /** Which vault adapter to use: "bitwarden", "json-file", or "none" */
    vault: 'bitwarden' | 'json-file' | 'none'
    /** Path for json-file vault adapter (default: ~/.runbrowser/credentials.json) */
    vaultPath?: string
    /** Policy overrides */
    policy?: {
      allowedDomains?: string[]
      approvalRequired?: string[]
      autoApproveDomains?: string[]
      maxLoginsPerDomain?: number
      sessionTimeout?: number
    }
    /** Enable audit logging (default: true) */
    auditLog?: boolean
    /** Custom audit log path (default: ~/.runbrowser/credential-audit.jsonl) */
    auditLogPath?: string
  }
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

const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
export const VERSION = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version as string

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
