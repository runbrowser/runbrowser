# RunBrowser

Control your running Chrome browser via Playwright — your logins, extensions,
and cookies already there. **No Playwright fork required.**

Based on [playwriter](https://github.com/remorses/playwriter) with all
functionality preserved, but using standard `playwright-core` instead of
maintaining a custom fork (`@xmorse/playwright-core`).

Other browser MCPs spawn a fresh Chrome — no logins, no extensions, instantly flagged by bot detectors, double the memory. RunBrowser connects to **your running browser** instead. One Chrome extension, full Playwright API, everything you're already logged into.

|               | Playwright MCP    | RunBrowser                        |
| ------------- | ----------------- | --------------------------------- |
| Browser       | Spawns new Chrome | **Uses your Chrome**              |
| Extensions    | None              | Your existing ones                |
| Login state   | Fresh             | Already logged in                 |
| Bot detection | Always detected   | Can bypass (disconnect extension) |
| Collaboration | Separate window   | Same browser as user              |

## Installation

1. [**Install Extension**](https://chromewebstore.google.com/detail/runbrowser-mcp/jfeammnjpkecdekppnclgkkffahnhfhe) from Chrome Web Store

2. Click extension icon on a tab → turns green when connected

3. Install the CLI and start automating the browser:

   ```bash
   npm i -g runbrowser
   runbrowser -s 1 -e 'await page.goto("https://example.com")'
   ```

## Quick Start

```bash
runbrowser session new  # creates stateful sandbox, outputs session id (e.g. 1)
runbrowser -s 1 -e 'await page.goto("https://example.com")'
runbrowser -s 1 -e 'console.log(await snapshot({ page }))'
runbrowser -s 1 -e 'await page.locator("aria-ref=e5").click()'
```

> **Tip:** Always use single quotes for `-e` to prevent bash from interpreting `$`, backticks, and `\` in your JS code. Use double quotes for strings inside the JS.

## CLI Usage

Each session has **isolated state**. Browser tabs are **shared** across sessions.

```bash
# Session management
runbrowser session new              # creates stateful sandbox, outputs id (e.g. 1)
runbrowser session list             # show sessions + state keys
runbrowser session reset <id>       # fix connection issues

# Execute (always use -s)
runbrowser -s 1 -e 'await page.goto("https://example.com")'
runbrowser -s 1 -e 'await page.click("button")'
runbrowser -s 1 -e 'console.log(await page.title())'
```

## MCP Setup

For direct MCP server configuration, see [MCP.md](./MCP.md).

```json
{
  "mcpServers": {
    "runbrowser": {
      "command": "npx",
      "args": ["-y", "runbrowser@latest"]
    }
  }
}
```

### MCP Tools

- **`execute`** — Run Playwright code snippets with `{page, state, context}` in scope
- **`reset`** — Recreate CDP connection and reset browser/page/context
- **`snapshot`** — Take accessibility snapshot of the current page (fast, text-based)
- **`screenshot`** — Take screenshot with Vimium-style accessibility labels overlaid

## Visual Labels

Vimium-style labels for AI agents to identify elements:

```javascript
await screenshotWithAccessibilityLabels({ page })
// Returns screenshot + accessibility snapshot with aria-ref selectors
await page.locator('aria-ref=e5').click()
```

Color-coded: yellow=links, orange=buttons, coral=inputs, pink=checkboxes, peach=sliders, salmon=menus, amber=tabs.

## Differences from Upstream Playwriter

The upstream project maintains a [fork of playwright-core](https://github.com/remorses/playwright.git)
to expose internal CDP APIs. RunBrowser achieves full feature parity using standard `playwright-core`:

| Upstream (fork required) | RunBrowser (standard playwright-core) |
|---|---|
| `page.targetId()` | `getTargetId(page)` via `_delegate._targetId` |
| `page.sessionId()` | `getSessionId(page)` via `_mainFrameSession._client._sessionId` |
| `frame.frameId()` | `getFrameId(frame)` via `frame._id` |
| `locator.selector()` | `getSelector(locator)` via `locator._selector` |
| `context.getExistingCDPSession(page)` | `getCDPSessionForPage()` with `RelayCDPSession` fallback |
| `page.onMouseAction` callback | Ghost cursor via `page.evaluate()` injection |

### Key files

- **`playwright-compat.ts`** — All private property access centralized here
- **`cdp-session.ts`** — `getCDPSessionForPage()` with adapter + fallback
- **`recording-ghost-cursor.ts`** — Rewritten to use `page.evaluate()` injection

## Architecture

```
+---------------------+     +-------------------+     +-----------------+
|   BROWSER           |     |   LOCALHOST       |     |   MCP CLIENT    |
|                     |     |                   |     |                 |
|  +---------------+  |     | WebSocket Server  |     |  +-----------+  |
|  |   Extension   |<--------->  :19988         |     |  | AI Agent  |  |
|  +-------+-------+  | WS  |                   |     |  +-----------+  |
|          |          |     |  /extension       |     |        |        |
|    chrome.debugger  |     |       |           |     |        v        |
|          v          |     |       v           |     |  +-----------+  |
|  +---------------+  |     |  /cdp/:id <--------------> |  execute  |  |
|  | Tab 1 (green) |  |     +-------------------+  WS |  +-----------+  |
|  | Tab 2 (green) |  |                               |        |        |
|  | Tab 3 (gray)  |  |     Tab 3 not controlled      |  Playwright API |
+---------------------+     (no extension click)      +-----------------+
```

## Playwright API

Connect programmatically (without CLI):

```typescript
import { chromium } from 'playwright-core'
import { startRunBrowserCDPRelayServer, getCdpUrl } from 'runbrowser'

const server = await startRunBrowserCDPRelayServer()
const browser = await chromium.connectOverCDP(getCdpUrl())
const page = browser.contexts()[0].pages()[0]

await page.goto('https://example.com')
await page.screenshot({ path: 'screenshot.png' })
// Don't call browser.close() - it closes the user's Chrome
server.close()
```

## Environment Variables

| Variable | Description |
|---|---|
| `RUNBROWSER_HOST` | Remote relay server host |
| `RUNBROWSER_TOKEN` | Authentication token |
| `RUNBROWSER_PORT` | Relay server port (default: 19988) |
| `RUNBROWSER_AUTO_ENABLE` | Auto-create tab on connect |
| `RUNBROWSER_BROWSER_PATH` | Custom Chrome executable path |
| `RUNBROWSER_LOG_FILE_PATH` | Custom log file path |



## Security

- **Local only**: WebSocket server on `localhost:19988`
- **Origin validation**: Only allowed extension IDs (browsers can't spoof Origin)
- **Explicit consent**: Only tabs where you clicked the extension icon
- **Visible automation**: Chrome shows automation banner on controlled tabs
- **No remote access**: Malicious websites cannot connect

## Troubleshooting

View relay server logs to debug issues:

```bash
runbrowser logfile  # prints the log file path
# typically: ~/.runbrowser/relay-server.log
```

## Known Issues

- If all pages return `about:blank`, restart Chrome (Chrome bug in `chrome.debugger` API)
- Browser may switch to light mode on connect ([Playwright issue](https://github.com/microsoft/playwright/issues/37627))

## Credits

Based on [playwriter](https://github.com/remorses/playwriter) by Tommaso De Rossi.
