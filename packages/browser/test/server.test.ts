/**
 * Route, guard and WebSocket coverage for the relay server.
 *
 * These run against a booted server rather than a mocked one: the surface they
 * cover is Bun's router, the CORS policy, the privileged guard and the upgrade
 * handshake, none of which exist below the network boundary.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { startRunBrowserCDPRelayServer, type RelayServer } from '../src/server/server.js'

const PORT = 8799
const BASE = `http://127.0.0.1:${PORT}`
const WS_BASE = `ws://127.0.0.1:${PORT}`
const EXT_ORIGIN = 'chrome-extension://pebbngnfojnignonigcnkdilknapkgid'

let server: RelayServer

beforeAll(async () => {
  server = await startRunBrowserCDPRelayServer({ port: PORT, host: '127.0.0.1' })
})

afterAll(() => {
  server?.close()
})

type WsOutcome = { opened: boolean; code?: number; reason?: string; socket: WebSocket }

/** Resolve once the socket settles: either it closes, or it stays open past the window. */
function connect(path: string, headers?: Record<string, string>): Promise<WsOutcome> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${WS_BASE}${path}`, { headers } as any)
    let opened = false
    const timer = setTimeout(() => resolve({ opened, socket }), 500)
    socket.onopen = () => { opened = true }
    socket.onclose = (e) => {
      clearTimeout(timer)
      resolve({ opened, code: e.code, reason: e.reason, socket })
    }
    socket.onerror = () => { clearTimeout(timer); resolve({ opened, socket }) }
  })
}

describe('discovery routes', () => {
  test('GET / is a plain OK', async () => {
    const response = await fetch(`${BASE}/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('OK')
  })

  test('GET /json/version returns the CDP handshake shape', async () => {
    const body = await (await fetch(`${BASE}/json/version`)).json()
    expect(body['Protocol-Version']).toBe('1.3')
    expect(body.webSocketDebuggerUrl).toMatch(/\/cdp$/)
  })

  test('PUT is accepted on discovery routes, as Chrome clients expect', async () => {
    expect((await fetch(`${BASE}/json/version`, { method: 'PUT' })).status).toBe(200)
  })

  test('GET /json/list is empty with no extension attached', async () => {
    expect(await (await fetch(`${BASE}/json/list`)).json()).toEqual([])
  })

  test('trailing-slash aliases resolve', async () => {
    expect((await fetch(`${BASE}/json/list/`)).status).toBe(200)
  })
})

describe('cors', () => {
  test('a known extension origin is echoed back', async () => {
    const response = await fetch(`${BASE}/version`, { headers: { origin: EXT_ORIGIN } })
    expect(response.headers.get('access-control-allow-origin')).toBe(EXT_ORIGIN)
  })

  test('an unknown origin gets no allow-origin header at all', async () => {
    const response = await fetch(`${BASE}/version`, { headers: { origin: 'https://evil.example' } })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('preflight is answered on a route that only declares POST', async () => {
    const response = await fetch(`${BASE}/api/execute`, {
      method: 'OPTIONS',
      headers: { origin: EXT_ORIGIN },
    })
    expect(response.status).toBe(204)
  })
})

describe('privileged guard', () => {
  test('rejects a POST that is not application/json', async () => {
    const response = await fetch(`${BASE}/api/execute`, { method: 'POST', body: '{}' })
    expect(response.status).toBe(415)
  })

  test('rejects a cross-site browser request outright', async () => {
    const response = await fetch(`${BASE}/api/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: '{}',
    })
    expect(response.status).toBe(403)
  })

  test('lets a same-origin json request through to the route', async () => {
    const response = await fetch(`${BASE}/api/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: '{}',
    })
    expect(response.status).toBe(400)
  })
})

describe('session routes', () => {
  test('a static path wins over the parameterized one', async () => {
    const body = await (await fetch(`${BASE}/api/session/suggest`)).json()
    expect(body.next).toBe(1)
  })

  test('an unknown session id falls to the parameterized route', async () => {
    expect((await fetch(`${BASE}/api/session/999`)).status).toBe(404)
  })

  test('creating a session with no browser attached says so plainly', async () => {
    const response = await fetch(`${BASE}/api/session/new`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(404)
    expect((await response.json()).error).toContain('No browser connected')
  })
})

describe('websocket endpoints', () => {
  test('/cdp closes 4003 when there is no extension to bind to', async () => {
    expect((await connect('/cdp/client-1')).code).toBe(4003)
  })

  test('/cdp without a client id routes to the same handler', async () => {
    expect((await connect('/cdp')).code).toBe(4003)
  })

  test('/extension refuses a non-extension origin', async () => {
    expect((await connect('/extension', { origin: 'https://evil.example' })).opened).toBe(false)
  })

  test('/extension refuses a missing origin', async () => {
    expect((await connect('/extension')).opened).toBe(false)
  })

  test('an accepted extension binds a cdp client, and unbinds on disconnect', async () => {
    const extension = await connect('/extension?browser=Chrome&id=p1&v=0.1.0', { origin: EXT_ORIGIN })
    expect(extension.opened).toBe(true)
    expect(extension.code).toBeUndefined()

    const status = await (await fetch(`${BASE}/extension/status`)).json()
    expect(status.connected).toBe(true)
    expect(status.browser).toBe('Chrome')

    const client = await connect('/cdp/client-2')
    expect(client.opened).toBe(true)
    expect(client.code).toBeUndefined()

    const duplicate = await connect('/cdp/client-2')
    expect(duplicate.code).toBe(4004)

    client.socket.close()
    extension.socket.close()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect((await (await fetch(`${BASE}/extension/status`)).json()).connected).toBe(false)
  })
})
