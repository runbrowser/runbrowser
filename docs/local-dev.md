# Local Development Guide

## Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Google Chrome

## Quick Start (3 terminals)

### Terminal 1: Build & Start Relay Server

```bash
cd /Users/yuanjiwei/Documents/GitHub/runbrowser

# Install dependencies (first time only)
pnpm install

# Build all packages
pnpm build

# Start relay server (foreground, with logs visible)
node packages/relay/dist/start.js
```

Server runs at `http://127.0.0.1:8790`. You should see:
```
CDP Relay Server running. Press Ctrl+C to stop.
```

### Terminal 2: Build & Load Extension into Chrome

```bash
cd /Users/yuanjiwei/Documents/GitHub/runbrowser

# Build extension (if not already built)
cd packages/extension && pnpm build
```

Then load it in Chrome:

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select: `/Users/yuanjiwei/Documents/GitHub/runbrowser/packages/extension/dist`
5. The RunBrowser extension icon appears in toolbar (gray icon)

**Connect a tab:**
1. Open any webpage (e.g. `https://example.com`)
2. Click the RunBrowser extension icon on that tab
3. Icon turns **green** = connected
4. Terminal 1 (relay server) should log the extension connection

### Terminal 3: Use CLI

```bash
cd /Users/yuanjiwei/Documents/GitHub/runbrowser

# Create a session
node packages/cli/bin.js session new
# Output: Session 1 created. Use with: runbrowser -s 1 -e "..."

# Execute code
node packages/cli/bin.js -s 1 -e "await page.goto('https://example.com')"
node packages/cli/bin.js -s 1 -e "page.title()"
node packages/cli/bin.js -s 1 -e "await page.screenshot({ path: '/tmp/test.png' })"
```

## Alternative: Use CLI to auto-start server

The CLI can auto-start the relay server (runs in background):

```bash
# This starts the server automatically if not running
node packages/cli/bin.js session new
```

But for development, running the server manually in Terminal 1 is better — you see all logs.

## Development with Watch Mode

### Watch extension changes

```bash
cd packages/extension
pnpm dev
# Rebuilds on file changes
# Then reload extension in Chrome: chrome://extensions/ → click refresh icon
```

### Watch relay changes

```bash
cd packages/relay
pnpm build --watch &
# Then restart server: node dist/start.js
```

## Using the MCP Server

To test the MCP server (what AI tools connect to):

```bash
# Start MCP server (communicates over stdio)
node packages/mcp/bin.js
```

Or configure in Claude Desktop / Cursor:

```json
{
  "mcpServers": {
    "runbrowser": {
      "command": "node",
      "args": ["/Users/yuanjiwei/Documents/GitHub/runbrowser/packages/mcp/bin.js"]
    }
  }
}
```

## Using `runbrowser serve` (for remote access)

If you want to expose the server to Docker or other machines:

```bash
# Bind to all interfaces (requires token for security)
node packages/cli/bin.js serve --host 0.0.0.0 --token mysecret

# From Docker, connect via:
# RUNBROWSER_HOST=host.docker.internal RUNBROWSER_TOKEN=mysecret
```

## Verify Everything Works

```bash
# 1. Check server is running
curl http://127.0.0.1:8790/version

# 2. Check extension is connected
curl http://127.0.0.1:8790/extension/status
# Should show: {"connected":true, ...}

# 3. Create session and run code
node packages/cli/bin.js session new
node packages/cli/bin.js -s 1 -e "document.title"
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Server won't start (port in use) | `lsof -i :8790` then `kill <PID>`, or use `node packages/cli/bin.js serve --replace` |
| Extension icon stays gray | Click the icon on a tab. Make sure relay server is running. Check Chrome DevTools → extension service worker for errors |
| `session new` hangs | Extension not connected. Click extension icon on a tab first |
| `ECONNREFUSED` | Relay server not running. Start it in Terminal 1 |
| Extension can't connect | Check relay server is on port 8790. Extension hardcodes `127.0.0.1:8790` |
| Build errors | Run `pnpm install` then `pnpm build` from root |

## Port Configuration

Default port is `8790`. To change:

```bash
# Server
RUNBROWSER_PORT=19999 node packages/relay/dist/start.js

# Extension (must rebuild with matching port)
cd packages/extension
RUNBROWSER_PORT=19999 pnpm build
# Then reload extension in Chrome

# CLI
RUNBROWSER_PORT=19999 node packages/cli/bin.js session new
```

## Log Files

```bash
# Show log file paths
node packages/cli/bin.js logfile

# Relay server logs (when auto-started by CLI)
cat ~/.runbrowser/relay.log

# CDP traffic logs
cat ~/.runbrowser/cdp.log
```
