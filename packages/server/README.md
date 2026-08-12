# @termio/browser-server

CDP (Chrome DevTools Protocol) relay server for [RunBrowser](https://github.com/runbrowser/runbrowser). This package bridges Chrome extension WebSocket connections to Playwright CDP clients, enabling browser automation over your running Chrome browser.

## Architecture

```
┌──────────────┐     WebSocket      ┌─────────────────┐     WebSocket      ┌────────────────┐
│   Chrome     │ ◄─────────────────►│  Relay Server   │ ◄─────────────────►│   Playwright   │
│  Extension   │    /extension      │  (this package)  │    /cdp/:clientId  │  CDP Client    │
└──────────────┘                    └─────────────────┘                    └────────────────┘
                                          │
                                          │  HTTP API
                                          │  /version, /json, /extension/status
                                          │  /cli/*, /recording/*
                                          ▼
```

The relay server:
- Accepts WebSocket connections from the RunBrowser Chrome extension
- Accepts WebSocket connections from Playwright CDP clients
- Routes CDP commands/events between them
- Manages extension connections, target tracking, and session state
- Provides HTTP endpoints for discovery, status, CLI execution, and recording

## Installation

```bash
npm install @termio/browser-server
```

## Usage

### Programmatic

```ts
import { startRunBrowserCDPRelayServer } from '@termio/browser-server'

const server = await startRunBrowserCDPRelayServer({
  port: 19988,
  host: '127.0.0.1',
  logger: console,
})

// Later...
server.close()
```

### With CLI Execute Endpoints

To enable `/cli/*` endpoints, provide an executor manager factory:

```ts
import { startRunBrowserCDPRelayServer } from '@termio/browser-server'

const server = await startRunBrowserCDPRelayServer({
  port: 19988,
  executorManagerFactory: async ({ cdpConfig, logger }) => {
    const { ExecutorManager } = await import('runbrowser/executor')
    return new ExecutorManager({ cdpConfig, logger })
  },
})
```

### Standalone Binary

```bash
npx @termio/browser-server
```

## Client Utilities

The package also provides client-side utilities for connecting to the relay server:

```ts
import { ensureRelayServer, RELAY_PORT, waitForConnectedExtensions } from '@termio/browser-server/client'

// Start relay server if not running
await ensureRelayServer({ logger: console })

// Wait for Chrome extension to connect
const extensions = await waitForConnectedExtensions({
  timeoutMs: 10000,
  logger: console,
})
```

## Exports

| Subpath | Description |
|---------|-------------|
| `@termio/browser-server` | Core server, state management, types, utilities |
| `@termio/browser-server/client` | Client utilities (ensureRelayServer, version checks) |
| `@termio/browser-server/types` | CDP protocol types |
| `@termio/browser-server/protocol` | Extension message protocol types |
| `@termio/browser-server/utils` | Shared utilities (EXTENSION_IDS, VERSION, log paths) |
| `@termio/browser-server/logger` | File logger |

## Key Types

```ts
// Server configuration
interface RelayServer {
  close(): void
  on<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]): void
  off<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]): void
}

// Executor dependency injection (for CLI endpoints)
interface ExecutorManagerLike { ... }
interface ExecutorLike { ... }
type ExecutorManagerFactory = (config: { cdpConfig, logger }) => Promise<ExecutorManagerLike>

// Relay state
interface ExtensionEntry { id, info, stableKey, connectedTargets, ws, ... }
interface PlaywrightClient { id, extensionId, ws }
interface RelayState { extensions, playwrightClients }
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TERMIO_BROWSER_PORT` | Relay server port (default: 19988) |
| `TERMIO_BROWSER_AUTO_ENABLE` | Auto-create initial tab for Playwright |
| `TERMIO_BROWSER_LOG_FILE_PATH` | Custom relay server log path |
| `TERMIO_BROWSER_CDP_LOG_FILE_PATH` | Custom CDP log path |

## License

MIT
