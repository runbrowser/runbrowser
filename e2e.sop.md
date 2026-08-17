# runbrowser End-to-End Testing Guide

## Prerequisites

```bash
# You need: Node.js ≥18, pnpm, Google Chrome
node -v    # v18+
pnpm -v    # any recent version
```

## Step 1 — Build Everything

```bash
cd /Users/yuanjiwei/Documents/GitHub/runbrowser

# Install dependencies
pnpm install

# Build all packages INCLUDING the Chrome extension
pnpm run build:all
```

This runs in order:
1. `runbrowser` (tsc) — WebSocket relay server
3. `runbrowser` + `runbrowser` cli (tsc, parallel) — MCP server + CLI
4. `mcp-extension` (vite + download-prism) — Chrome extension → `packages/extension/dist/`

## Step 2 — Load Extension into Chrome

1. Open Chrome → navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **"Load unpacked"**
4. Select the folder: `<project>/packages/extension/dist`
5. The extension appears — note the **extension ID** (e.g. `pebbngnfojnignonigcnkdilknapkgid` for dev builds)
6. Pin it to the toolbar for easy access

## Step 3 — Enable Extension on a Tab

1. Open any webpage in Chrome (e.g. `https://example.com`)
2. **Click the runbrowser extension icon** on that tab
3. Icon turns **green** = tab is now controlled via CDP
4. Chrome shows an **"is debugging this tab"** banner — this is expected

> Gray icon = not connected. Green icon = connected and ready.
> You can enable multiple tabs — each green tab is available to Playwright.

## Step 4 — Start Relay Server + Create Session

The relay server starts automatically when you run CLI commands. But you can also start it explicitly:

```bash
# Option A: auto-start (relay starts in background on first CLI command)
cd /Users/yuanjiwei/Documents/GitHub/runbrowser
node packages/cli/bin.js session new

# Option B: start relay explicitly in foreground (useful for debugging)
node packages/relay/bin.js
# In another terminal:
node packages/cli/bin.js session new
```

`session new` output:
```
Session 1 created. Use with: runbrowser -s 1 -e "..."
```

## Step 5 — Execute Commands via CLI

```bash
# Navigate
node packages/cli/bin.js -s 1 -e 'await page.goto("https://example.com")'

# Get page title
node packages/cli/bin.js -s 1 -e 'console.log(await page.title())'

# Take accessibility snapshot (text, fast)
node packages/cli/bin.js -s 1 -e 'console.log(await snapshot({ page }))'

# Screenshot with accessibility labels
node packages/cli/bin.js -s 1 -e 'await screenshotWithAccessibilityLabels({ page })'

# Click an element by aria-ref (from snapshot output)
node packages/cli/bin.js -s 1 -e 'await page.locator("aria-ref=e5").click()'

# Type into a field
node packages/cli/bin.js -s 1 -e 'await page.locator("input[name=q]").fill("hello world")'

# Read page content as markdown
node packages/cli/bin.js -s 1 -e 'console.log(await getPageMarkdown({ page }))'
```

> **Tip:** Always use single quotes for `-e` to prevent bash from interpreting `$` and backticks.

## Step 6 — Session Management

```bash
# List active sessions
node packages/cli/bin.js session list

# Reset a broken connection
node packages/cli/bin.js session reset 1

# Delete a session
node packages/cli/bin.js session delete 1
```

## Step 7 — Debug If Things Go Wrong

```bash
# Print log file paths
node packages/cli/bin.js logfile
# → relay: ~/.runbrowser/relay-server.log
# → cdp:   ~/.runbrowser/cdp.jsonl

# Tail the relay log in real-time
tail -f ~/.runbrowser/relay-server.log

# Check extension connection status
curl http://127.0.0.1:19988/extension/status
# → {"connected":true,"activeTargets":1,...}

# Check what tabs are available
curl http://127.0.0.1:19988/json/list
```

## Data Flow (What Happens)

```
You click extension icon on Tab
        │
        ▼
Extension connects WebSocket → ws://127.0.0.1:19988/extension
        │
        ▼
Relay server (:19988) holds the connection
        │
        ▼
CLI "session new" → HTTP POST /cli/session/new → creates executor
        │
        ▼
CLI "-s 1 -e '...'" → HTTP POST /cli/execute
        │
        ▼
Executor connects Playwright → ws://127.0.0.1:19988/cdp/<id>
        │
        ▼
Relay bridges CDP commands ↔ Extension ↔ chrome.debugger API ↔ Tab
```

## Common Issues

| Problem | Fix |
|---|---|
| Extension icon stays gray | Click it again on the tab. Check `chrome://extensions/` for errors. |
| "Extension not connected" | Click extension icon on at least one tab first. |
| All pages return `about:blank` | Restart Chrome entirely (known Chrome bug). |
| Connection timeout | Check `~/.runbrowser/relay-server.log` for errors. |
| Port 19988 in use | `node packages/cli/bin.js serve --replace` or `lsof -i :19988` |
| Old relay running | CLI auto-restarts on version mismatch, or kill manually: `kill $(lsof -t -i :19988)` |
