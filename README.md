# RunBrowser

> Getting Started with RunBrowser — Control your browser via Playwright API. Uses extension + CLI. No context bloat.

Other browser MCPs spawn a fresh Chrome — no logins, no extensions, instantly flagged by bot detectors, double the memory. RunBrowser connects to **your running browser** instead. One Chrome extension, full Playwright API, everything you're already logged into.

|               | Playwright MCP    | RunBrowser                        |
| ------------- | ----------------- | --------------------------------- |
| Browser       | Spawns new Chrome | **Uses your Chrome**              |
| Extensions    | None              | Your existing ones                |
| Login state   | Fresh             | Already logged in                 |
| Bot detection | Always detected   | Can bypass (disconnect extension) |
| Collaboration | Separate window   | Same browser as user              |

## Installation

### 1. Install the Extension

Load the extension in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **"Load unpacked"** and select the `packages/extension/dist` folder

> Or install from [Chrome Web Store](https://chromewebstore.google.com/detail/runbrowser/jfeammnjpkecdekppnclgkkffahnhfhe) once available.

### 2. Pin the Extension

Click the puzzle icon in Chrome's toolbar, then pin **RunBrowser** so it's always visible.

### 3. Enable a Tab

Click the extension icon on a tab. It turns **green** when connected.

### 4. Install the CLI and Run a Command

```bash
# install the CLI globally
npm i -g @agmod/runbrowser

# create a session
runbrowser session-new

# navigate to a URL in the active tab
runbrowser exec -s 1 -e "await page.goto('https://example.com')"
```

### 5. Add the Skill to Your Agent (Optional)

Install the RunBrowser skill so your coding agent can call the CLI:

```bash
npx -y skills add yuanjiwei/runbrowser
```

## Icon States

| Icon   | Meaning                                |
| ------ | -------------------------------------- |
| Gray   | Not connected to any tab               |
| Green  | Successfully connected and ready       |
| Orange badge (...) | Connecting to relay server |
| Red badge (!)      | Error occurred             |

## CLI Examples

```bash
# create a stateful sandbox, outputs session id (e.g. 1)
runbrowser session-new

# navigate to a URL
runbrowser exec -s 1 -e "await page.goto('https://example.com')"

# get the accessibility tree of the page
runbrowser exec -s 1 -e "console.log(await snapshot({ page }))"

# click an element by its accessibility reference
runbrowser exec -s 1 -e "await page.locator('aria-ref=e5').click()"
```

> **Tip:** Always use single quotes for `-e` to prevent bash from interpreting `$`, backticks, and `\` in your JS code. Use double quotes for strings inside the JS.

## CLI Usage

Each session has **isolated state**. Browser tabs are **shared** across sessions.

```bash
# Session management
runbrowser session-new              # creates stateful sandbox, outputs id (e.g. 1)
runbrowser session-list             # show sessions + state keys
runbrowser session-reset <id>       # fix connection issues

# Execute (always use -s)
runbrowser exec -s 1 -e 'await page.goto("https://example.com")'
runbrowser exec -s 1 -e 'await page.click("button")'
runbrowser exec -s 1 -e 'console.log(await page.title())'

# High-level commands
runbrowser navigate <url> -s 1
runbrowser snapshot -s 1
runbrowser screenshot -s 1 --output shot.png
runbrowser click <ref> -s 1
runbrowser fill <ref> <value> -s 1
runbrowser type <text> -s 1
runbrowser press <key> -s 1
runbrowser scroll <direction> -s 1

# Start relay server (foreground, for remote access)
runbrowser serve --host 0.0.0.0 --token <secret>
```

## How It Works

- **No new Chrome instances**: Works with your current browser session
- **No CDP mode required**: No need to restart Chrome with special flags
- **Full CDP access**: Complete Chrome DevTools Protocol capabilities
- **Visual feedback**: Extension icon changes color to indicate connection status

## MCP Setup (Optional)

The CLI is the recommended way to use RunBrowser. If you need MCP server setup, auto-configure it with:

```json
{
  "mcpServers": {
    "runbrowser": {
      "command": "npx",
      "args": ["-y", "@agmod/runbrowser-mcp@latest"]
    }
  }
}
```

For full MCP instructions, see [MCP.md](./MCP.md).

## Visual Labels

Vimium-style labels for AI agents to identify elements:

```javascript
await screenshotWithAccessibilityLabels({ page })
// Returns screenshot + accessibility snapshot with aria-ref selectors
await page.locator('aria-ref=e5').click()
```

Color-coded: yellow=links, orange=buttons, coral=inputs, pink=checkboxes, peach=sliders, salmon=menus, amber=tabs.

## Playwright API

Connect programmatically (without CLI):

```typescript
import { chromium } from 'playwright-core'
import { startRunBrowserCDPRelayServer, getCdpUrl } from '@agmod/runbrowser-relay'

const server = await startRunBrowserCDPRelayServer()
const browser = await chromium.connectOverCDP(getCdpUrl())
const page = browser.contexts()[0].pages()[0]

await page.goto('https://example.com')
await page.screenshot({ path: 'screenshot.png' })
// Don't call browser.close() - it closes the user's Chrome
server.close()
```

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

## Environment Variables

| Variable | Description |
|---|---|
| `RUNBROWSER_HOST` | Remote relay server host |
| `RUNBROWSER_TOKEN` | Authentication token |
| `RUNBROWSER_PORT` | Relay server port (default: 19988) |
| `RUNBROWSER_SESSION` | Default session ID (avoids `-s` flag) |
| `RUNBROWSER_AUTO_ENABLE` | Auto-create tab on connect |

## Privacy & Security

RunBrowser runs locally in your browser and does not send any data to external servers. All browser control happens through the standard Chrome DevTools Protocol on your machine.

- **Local only**: WebSocket server on `localhost:19988`
- **Origin validation**: Only allowed extension IDs
- **Explicit consent**: Only tabs where you clicked the extension icon
- **Visible automation**: Chrome shows automation banner on controlled tabs

## Troubleshooting

View relay server logs to debug issues:

```bash
runbrowser logfile  # prints the log file path
# typically: ~/.runbrowser/relay-server.log
```

## Known Issues

- If all pages return `about:blank`, restart Chrome (Chrome bug in `chrome.debugger` API)
- Browser may switch to light mode on connect ([Playwright issue](https://github.com/microsoft/playwright/issues/37627))

## Need Help?

For issues, feature requests, or contributions, visit the [GitHub repository](https://github.com/yuanjiwei/runbrowser).

## Credits

Based on [playwriter](https://github.com/remorses/playwriter) by Tommaso De Rossi.

## License

MIT
