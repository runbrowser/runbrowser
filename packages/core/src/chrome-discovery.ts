/**
 * Chrome instance discovery for direct CDP connections.
 *
 * Probes the default CDP port (9222) via GET /json/version.
 * If Chrome responds with a valid webSocketDebuggerUrl, the instance is usable.
 *
 * Chrome 136+ with chrome://inspect debugging returns 404 on all HTTP endpoints
 * but still accepts WebSocket connections on /devtools/browser/*. In that case
 * (status 'blocked'), we return a synthetic wsUrl — the actual WS connection
 * only happens when the user explicitly runs a command.
 *
 * For non-default ports or remote hosts, pass an explicit endpoint.
 */

export interface DiscoveredInstance {
  browser: string
  port: number
  wsUrl: string
}

interface JsonVersionResponse {
  Browser?: string
  webSocketDebuggerUrl?: string
  'Protocol-Version'?: string
}

type PortProbeStatus =
  | { type: 'live'; wsUrl: string; browser: string }
  | { type: 'blocked'; port: number; hostname: string }
  | { type: 'dead' }

/**
 * Probe a port via GET /json/version.
 *
 * Returns:
 * - 'live'    — Chrome responded with valid CDP JSON containing webSocketDebuggerUrl
 * - 'blocked' — HTTP response received but no CDP info (Chrome 136+ default profile)
 * - 'dead'    — connection refused or timeout (nothing listening)
 */
async function probePortStatus(port: number, hostname = '127.0.0.1'): Promise<PortProbeStatus> {
  try {
    const response = await fetch(`http://${hostname}:${port}/json/version`, {
      signal: AbortSignal.timeout(1000),
    })
    if (!response.ok) {
      await response.text() // consume body
      return { type: 'blocked', port, hostname }
    }
    const data = (await response.json()) as JsonVersionResponse
    if (data.webSocketDebuggerUrl) {
      return { type: 'live', wsUrl: data.webSocketDebuggerUrl, browser: data.Browser || 'Unknown' }
    }
    return { type: 'blocked', port, hostname }
  } catch {
    return { type: 'dead' }
  }
}

/**
 * Probe a port via GET /json/version.
 * Returns the webSocketDebuggerUrl and browser name, or null.
 */
export async function probePort(port: number, hostname = '127.0.0.1'): Promise<{ wsUrl: string; browser: string } | null> {
  const status = await probePortStatus(port, hostname)
  if (status.type === 'live') {
    return { wsUrl: status.wsUrl, browser: status.browser }
  }
  return null
}

/** Build a ws:// URL for direct CDP when /json/version returns 404 (Chrome 136+). */
function makeDirectWsUrl(hostname: string, port: number): string {
  return `ws://${hostname}:${port}/devtools/browser/`
}

/**
 * Discover Chrome on the default CDP port (9222).
 *
 * Probes /json/version. If Chrome responds with valid CDP JSON, returns the
 * instance with full browser info. If Chrome returns 404 (Chrome 136+),
 * returns a synthetic instance.
 */
export async function discoverChromeInstances(port = 9222): Promise<DiscoveredInstance[]> {
  const status = await probePortStatus(port)

  if (status.type === 'live') {
    return [
      {
        browser: parseBrowserVersion(status.browser),
        port,
        wsUrl: status.wsUrl,
      },
    ]
  }

  if (status.type === 'blocked') {
    return [
      {
        browser: 'Chrome',
        port: status.port,
        wsUrl: makeDirectWsUrl(status.hostname, status.port),
      },
    ]
  }

  return []
}

/**
 * Resolve a --direct input value to a WebSocket URL.
 *
 * Accepts:
 * - ws:// or wss:// URL — returned as-is
 * - host:port — probes /json/version to get the webSocketDebuggerUrl
 * - bare port number — probes localhost:port
 *
 * Throws with a clear message if the endpoint can't be resolved.
 */
export async function resolveDirectInput(input: string): Promise<string> {
  if (input.startsWith('ws://') || input.startsWith('wss://')) {
    return input
  }

  // Bare port number
  if (/^\d+$/.test(input)) {
    const port = parseInt(input, 10)
    const status = await probePortStatus(port)
    if (status.type === 'live') return status.wsUrl
    if (status.type === 'blocked') return makeDirectWsUrl('127.0.0.1', port)
    throw new Error(
      `Nothing found on localhost:${port}. Is Chrome running with remote debugging enabled? ` +
        `Try: chrome --remote-debugging-port=${port}`,
    )
  }

  const match = input.match(/^([^:]+):(\d+)$/)
  if (!match) {
    throw new Error(
      `Invalid endpoint: expected a ws:// URL, host:port, or port number. Got: ${input}`,
    )
  }

  const [, hostname, portStr] = match
  const port = parseInt(portStr, 10)
  const status = await probePortStatus(port, hostname)

  if (status.type === 'live') {
    return status.wsUrl
  }

  if (status.type === 'blocked') {
    return makeDirectWsUrl(hostname, port)
  }

  throw new Error(
    `Nothing found on ${hostname}:${port}. Is Chrome running with remote debugging enabled? ` +
      `Try: chrome --remote-debugging-port=${port}`,
  )
}

function parseBrowserVersion(browserString: string): string {
  if (browserString.startsWith('HeadlessChrome/')) return 'Chrome (Headless)'
  if (browserString.startsWith('Chrome/')) return 'Chrome'
  const slashIndex = browserString.indexOf('/')
  if (slashIndex > 0) return browserString.slice(0, slashIndex)
  return browserString
}
