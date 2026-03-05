# RunBrowser

> Getting Started with RunBrowser — Control your browser via CDP. Uses extension + CLI. No context bloat.

Other browser MCPs spawn a fresh Chrome — no logins, no extensions, instantly flagged by bot detectors, double the memory. RunBrowser connects to **your running browser** instead. One Chrome extension, full CDP access, everything you're already logged into.

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

# navigate to a URL
runbrowser navigate https://example.com -s 1

# or execute browser JavaScript directly
runbrowser exec -s 1 -e "document.title"
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
# create a session, outputs session id (e.g. 1)
runbrowser session-new

# navigate to a URL
runbrowser navigate https://example.com -s 1

# get the accessibility tree of the page
runbrowser snapshot -s 1

# click an element by its @ref from snapshot (e.g. @e5)
runbrowser click @e5 -s 1

# execute browser JavaScript via CDP Runtime.evaluate
runbrowser exec -s 1 -e 'document.title'

# evaluate JS and get console output
runbrowser evaluate 'document.querySelectorAll("a").length' -s 1
```

## CLI Usage

Each session has **isolated state**. Browser tabs are **shared** across sessions.

```bash
# Session management
runbrowser session-new              # creates stateful sandbox, outputs id (e.g. 1)
runbrowser session-list             # show sessions + state keys
runbrowser session-delete <id>      # delete a session and clear its state
runbrowser session-reset <id>       # fix connection issues

# Execute browser JS via CDP (always use -s)
runbrowser exec -s 1 -e 'document.title'
runbrowser exec -s 1 -e 'document.querySelector("button").click()'
runbrowser exec -s 1 -e 'window.location.href'

# High-level commands
runbrowser navigate <url> -s 1
runbrowser snapshot -s 1
runbrowser screenshot -s 1 --output shot.png
runbrowser click <ref> -s 1
runbrowser fill <ref> <value> -s 1
runbrowser type <text> -s 1
runbrowser press <key> -s 1
runbrowser scroll <direction> -s 1
runbrowser hover <ref> -s 1
runbrowser evaluate <code> -s 1
runbrowser get-url -s 1
runbrowser get-title -s 1
runbrowser back -s 1
runbrowser forward -s 1
runbrowser reload -s 1

# Wait for conditions
runbrowser wait @e5 -s 1                              # wait for element to be visible
runbrowser wait 2000 -s 1                              # wait 2 seconds
runbrowser wait --text "Welcome" -s 1                  # wait for text to appear
runbrowser wait --url "**/dashboard" -s 1              # wait for URL pattern
runbrowser wait --load networkidle -s 1                # wait for load state
runbrowser wait --fn "document.querySelectorAll('.item').length >= 10" -s 1  # wait for JS condition

# Config management (persistent settings in ~/.runbrowser/config.json)
runbrowser config-set <key> <value>   # set token or host
runbrowser config-unset <key>         # remove a config value
runbrowser config-show                # show current config

# Utilities
runbrowser logfile                    # print log file paths
runbrowser skill                     # print full usage instructions

# Start relay server (foreground, for remote access)
runbrowser serve --host 0.0.0.0 --token <secret>
```

## How It Works

RunBrowser uses the **Chrome DevTools Protocol (CDP)** directly — no Playwright dependency required for CLI or MCP usage. The extension bridges CDP commands over WebSocket to your running browser.

- **No new Chrome instances**: Works with your current browser session
- **No CDP mode required**: No need to restart Chrome with special flags
- **Full CDP access**: Complete Chrome DevTools Protocol capabilities
- **Visual feedback**: Extension icon changes color to indicate connection status

The `exec` command runs JavaScript in the **browser page context** via `Runtime.evaluate` — it's plain browser JS, not a Node.js/Playwright sandbox.

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

The MCP server exposes these tools: `navigate`, `snapshot`, `screenshot`, `click`, `fill`, `type`, `press`, `scroll`, `hover`, `evaluate`, `get_url`, `get_title`, `back`, `forward`, `reload`, `reset`, and `execute`.

For full MCP instructions, see [MCP.md](./MCP.md).

## Accessibility Snapshots

Snapshots return a text-based accessibility tree with `@ref` labels on interactive elements:

```
- banner:
  - link "Home" @e1
  - navigation:
    - link "Docs" @e2
    - link "Blog" @e3
```

Use refs to interact with elements:

```bash
# Via high-level CLI commands
runbrowser click @e3 -s 1

# Via exec (browser JS)
runbrowser exec -s 1 -e 'document.querySelector("a[href=\"/blog\"]").click()'
```

## Playwright API (Optional)

The relay server also exposes a standard CDP WebSocket endpoint, so you can optionally connect with Playwright for its full API (locators, auto-waiting, etc.):

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

> **Note:** The CLI and MCP use CDP directly and do **not** require `playwright-core` as a dependency.

## Architecture

```
+---------------------+     +-------------------+     +-----------------+
|   BROWSER           |     |   LOCALHOST        |     |   CLIENT        |
|                     |     |                   |     |                 |
|  +---------------+  |     | WebSocket Server  |     |  +-----------+  |
|  |   Extension   |<--------->  :19988         |     |  | AI Agent  |  |
|  +-------+-------+  | WS  |                   |     |  +-----------+  |
|          |          |     |  /extension       |     |        |        |
|    chrome.debugger  |     |       |           |     |        v        |
|          v          |     |       v           |     |  +-----------+  |
|  +---------------+  |     |  /cdp/:id <--------------> |  CLI/MCP  |  |
|  | Tab 1 (green) |  |     +-------------------+  WS |  +-----------+  |
|  | Tab 2 (green) |  |                               |        |        |
|  | Tab 3 (gray)  |  |     Tab 3 not controlled      |    CDP API      |
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
| `RUNBROWSER_LOG_FILE_PATH` | Custom path for relay server log file |
| `RUNBROWSER_CDP_LOG_FILE_PATH` | Custom path for CDP JSONL log file |

## Privacy & Security

RunBrowser runs locally in your browser and does not send any data to external servers. All browser control happens through the standard Chrome DevTools Protocol on your machine.

- **Local only**: WebSocket server on `localhost:19988`
- **Origin validation**: Only allowed extension IDs
- **Explicit consent**: Only tabs where you clicked the extension icon
- **Visible automation**: Chrome shows automation banner on controlled tabs

## Troubleshooting

View relay server logs to debug issues:

```bash
runbrowser logfile  # prints the log file paths
# relay: ~/.runbrowser/relay-server.log
# cdp:   ~/.runbrowser/cdp.jsonl
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
