# RunBrowser

> Control your browser via CDP. Uses extension + CLI. No context bloat.

Other browser MCPs spawn a fresh Chrome — no logins, no extensions, instantly flagged by bot detectors, double the memory. RunBrowser connects to **your running browser** instead. One Chrome extension, full CDP access, everything you're already logged into.

|               | Playwright MCP    | RunBrowser                        |
| ------------- | ----------------- | --------------------------------- |
| Browser       | Spawns new Chrome | **Uses your Chrome**              |
| Extensions    | None              | Your existing ones                |
| Login state   | Fresh             | Already logged in                 |
| Bot detection | Always detected   | Can bypass (disconnect extension) |
| Collaboration | Separate window   | Same browser as user              |

## Quick Start

```bash
# 1. Install the CLI
npm i -g @jiweiyuan/runbrowser

# 2. Load extension: chrome://extensions/ → Developer mode → Load unpacked → packages/extension/dist
# 3. Click the extension icon on a tab — it turns green

# 4. Use it
runbrowser session-new
runbrowser navigate https://example.com -s 1
runbrowser snapshot -s 1
runbrowser click @e5 -s 1
```

### Add the Skill to Your Agent

```bash
npx -y skills add yuanjiwei/runbrowser
```

This teaches your agent how to use RunBrowser — selectors, timeouts, snapshots, and all available utilities.

## How It Works

RunBrowser uses the **Chrome DevTools Protocol (CDP)** directly. The extension bridges CDP commands over WebSocket to your running browser.

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   BROWSER           │     │   LOCALHOST          │     │   CLIENT        │
│                     │     │                      │     │                 │
│  ┌───────────────┐  │     │ WebSocket Server     │     │  ┌───────────┐  │
│  │   Extension   │<───────┬───>  :19988          │     │  │ CLI / MCP │  │
│  └───────┬───────┘  │ WS  │                      │     │  └───────────┘  │
│          │          │     │  /extension          │     │        │        │
│    chrome.debugger  │     │       │              │     │        v        │
│          v          │     │       v              │     │  ┌────────────┐ │
│  ┌───────────────┐  │     │  /cdp/:id <───────────────>│  │  CDP API   │ │
│  │ Tab 1 (green) │  │     └──────────────────────┘  WS │  └────────────┘ │
│  │ Tab 2 (green) │  │                                  │        │        │
│  │ Tab 3 (gray)  │  │     Tab 3 not controlled         │  Playwright API │
└─────────────────────┘     (extension not clicked)      └─────────────────┘
```

- **No new Chrome instances** — works with your current browser session
- **No CDP mode required** — no need to restart Chrome with special flags
- **Full CDP access** — complete Chrome DevTools Protocol capabilities
- **Visual feedback** — extension icon changes color (green = connected, gray = inactive)

## CLI Reference

### Session Management

Each session has **isolated state**. Browser tabs are **shared** across sessions.

```bash
runbrowser session new              # create sandbox, outputs id (e.g. 1)
runbrowser session list             # show sessions + state keys
runbrowser session delete <id>      # delete a session
runbrowser session reset <id>       # fix stale connections
```

### Navigation

```bash
runbrowser navigate <url> -s 1      # navigate to URL (aliases: open, goto)
runbrowser back -s 1                # go back
runbrowser forward -s 1             # go forward
runbrowser reload -s 1              # reload page
runbrowser close -s 1               # close current tab
```

### Observation

```bash
runbrowser snapshot -s 1                        # accessibility tree with @refs
runbrowser snapshot -s 1 -i                     # interactive elements only
runbrowser snapshot -s 1 -S "main"              # scope to CSS selector
runbrowser screenshot -s 1 shot.png             # take screenshot
runbrowser screenshot -s 1 shot.png -F          # full page screenshot
runbrowser screenshot -s 1 shot.png -a          # annotated with element labels
runbrowser get url -s 1                         # get current URL
runbrowser get title -s 1                       # get page title
runbrowser get text @e5 -s 1                    # get element text
runbrowser get html @e5 -s 1                    # get element HTML
runbrowser get attr @e5 --attr-name href -s 1   # get attribute value
runbrowser get count @e5 -s 1                   # count matching elements
runbrowser is visible @e5 -s 1                  # check element state
runbrowser is checked @e5 -s 1
runbrowser is enabled @e5 -s 1
```

### Interaction

```bash
runbrowser click @e5 -s 1                   # click element
runbrowser dblclick @e5 -s 1                # double-click
runbrowser fill @e3 "hello world" -s 1      # clear + fill input
runbrowser type "search query" -s 1         # type at current focus
runbrowser press Enter -s 1                 # press key
runbrowser select @e5 "option-value" -s 1   # select dropdown option
runbrowser check @e5 -s 1                   # check checkbox
runbrowser uncheck @e5 -s 1                 # uncheck checkbox
runbrowser scroll down -s 1                 # scroll direction (up/down/left/right)
runbrowser scroll down 500 -s 1             # scroll by pixels
runbrowser hover @e5 -s 1                   # hover element
runbrowser focus @e5 -s 1                   # focus element
runbrowser upload @e5 ./file.png -s 1       # upload files
runbrowser drag @e1 @e2 -s 1               # drag source to target
runbrowser viewport 1280 720 -s 1           # set viewport size
```

### Wait Conditions

```bash
runbrowser wait @e5 -s 1                    # wait for element visible
runbrowser wait 2000 -s 1                   # wait milliseconds
runbrowser wait --text "Welcome" -s 1       # wait for text
runbrowser wait --url "**/dashboard" -s 1   # wait for URL pattern
runbrowser wait --load networkidle -s 1     # wait for load state
runbrowser wait --fn "document.querySelectorAll('.item').length >= 10" -s 1
```

### Semantic Locators

```bash
# Find by role, text, label, placeholder, or testid — then act
runbrowser find role button click --name "Submit" -s 1
runbrowser find text "Sign in" click -s 1
runbrowser find label "Email" fill "user@example.com" -s 1
runbrowser find placeholder "Search" type "query" -s 1
runbrowser find testid "submit-btn" click -s 1
```

### Tab & Frame Management

```bash
runbrowser tab list -s 1                    # list all tabs
runbrowser tab new https://example.com -s 1 # open new tab
runbrowser tab 2 -s 1                       # switch to tab index
runbrowser tab close -s 1                   # close current tab
runbrowser frame "iframe#embed" -s 1        # switch to iframe
runbrowser frame main -s 1                  # return to main frame
```

### Execution

```bash
runbrowser eval 'document.title' -s 1                   # run JS in browser context
runbrowser cdp Page.captureScreenshot '{}' -s 1          # raw CDP command
runbrowser diff snapshot -s 1                             # compare snapshots
runbrowser diff screenshot -b baseline.png -s 1           # compare screenshots
```

### Recording

Record browser tab video (H.264 MP4). Requires `ffmpeg` installed.

```bash
runbrowser record start -o recording.mp4 -s 1   # start recording
runbrowser record stop -s 1                       # stop and save (auto-transcodes to H.264)
runbrowser record status -s 1                     # check if recording
runbrowser record cancel -s 1                     # cancel without saving
```

For automated recording without clicking the extension icon, restart Chrome with:

```bash
# macOS (set your profile name first)
runbrowser config set profile "Profile 11"
open -a "Google Chrome" --args --auto-accept-this-tab-capture --profile-directory="Profile 11"
```

### Command Extensions

Install community-maintained site commands from the [runbrowser/commands](https://github.com/runbrowser/commands) repo.

```bash
runbrowser commands list              # list available extensions
runbrowser commands install reddit    # install an extension
runbrowser commands uninstall reddit  # remove an extension

# Use installed commands immediately
runbrowser reddit hot --limit 5
runbrowser reddit search "browser automation"
```

### Configuration

```bash
runbrowser config set <key> <value>   # set token, host, etc.
runbrowser config unset <key>         # remove a config value
runbrowser config show                # show current config
runbrowser logfile                    # print log file paths
runbrowser skill                      # print full agent instructions
```

## Accessibility Snapshots

Snapshots return a text-based accessibility tree with `@ref` labels on interactive elements — **5–20 KB** instead of 100 KB+ for screenshots:

```
- banner:
  - link "Home" @e1
  - navigation:
    - link "Docs" @e2
    - link "Blog" @e3
- main:
  - heading "Welcome" @e4
  - button "Get started" @e5
```

Use refs directly in commands:

```bash
runbrowser click @e5 -s 1
runbrowser fill @e3 "search term" -s 1
runbrowser get text @e4 -s 1
```

## MCP Setup

The CLI is the recommended way to use RunBrowser. For MCP server integration:

```json
{
  "mcpServers": {
    "runbrowser": {
      "command": "npx",
      "args": ["-y", "@jiweiyuan/runbrowser-mcp@latest"]
    }
  }
}
```

MCP tools: `navigate`, `snapshot`, `screenshot`, `click`, `fill`, `type`, `press`, `scroll`, `hover`, `evaluate`, `get_url`, `get_title`, `back`, `forward`, `reload`, `reset`.

For full MCP instructions, see [MCP.md](./MCP.md).

## Remote Access

Control Chrome on a remote machine — headless Mac mini, cloud VM, devcontainer:

```bash
# On the host machine
runbrowser serve --host 0.0.0.0 --token <secret>

# From anywhere
export RUNBROWSER_HOST=192.168.1.10
export RUNBROWSER_TOKEN=<secret>
runbrowser navigate https://example.com -s 1
```

For Docker/devcontainers, use `RUNBROWSER_HOST=host.docker.internal`.

## Playwright API (Optional)

The relay exposes a standard CDP WebSocket endpoint for Playwright:

```typescript
import { chromium } from 'playwright-core'
import { startRunBrowserCDPRelayServer, getCdpUrl } from '@jiweiyuan/runbrowser-server'

const server = await startRunBrowserCDPRelayServer()
const browser = await chromium.connectOverCDP(getCdpUrl())
const page = browser.contexts()[0].pages()[0]

await page.goto('https://example.com')
await page.screenshot({ path: 'screenshot.png' })
// Don't call browser.close() — it closes the user's Chrome
server.close()
```

> The CLI and MCP use CDP directly and do **not** require `playwright-core`.

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

## Project Structure

```
packages/
├── cli/          # @jiweiyuan/runbrowser — CLI
├── core/         # @jiweiyuan/runbrowser-core — shared: a11y, debugger, editor, recording
├── server/       # @jiweiyuan/runbrowser-server — WebSocket relay, CDP bridge, site commands
├── mcp/          # @jiweiyuan/runbrowser-mcp — MCP server (thin HTTP wrapper)
├── extension/    # Chrome extension (chrome.debugger ↔ WebSocket)
├── e2e/          # End-to-end tests
├── website/      # Next.js + next-intl marketing site (en/zh/ja/fr/es)
└── vite-plugin-extension-reload/  # Dev tool for extension hot reload
```

## Icon States

| Icon | Meaning |
|------|---------|
| Gray | Not connected to any tab |
| Green | Connected and ready |
| Orange badge (...) | Connecting to relay server |
| Red badge (!) | Error occurred |

## Security

- **Local only** — WebSocket server binds to `localhost:19988`
- **Origin validation** — only the RunBrowser extension origin is accepted
- **Explicit consent** — only tabs where you clicked the extension icon
- **Visible automation** — Chrome shows an automation banner on controlled tabs

## Troubleshooting

```bash
runbrowser logfile  # prints log file paths
# relay: ~/.runbrowser/relay-server.log
# cdp:   ~/.runbrowser/cdp.jsonl
```

| Problem | Fix |
|---|---|
| Extension icon stays gray | Click it again. Check `chrome://extensions/` for errors. |
| "Extension not connected" | Click extension icon on at least one tab. |
| All pages return `about:blank` | Restart Chrome (known Chrome bug). |
| Port 19988 in use | `lsof -ti :19988 \| xargs kill` |

## Acknowledgements

RunBrowser wouldn't exist without the work of these projects and their maintainers.

- [playwriter](https://github.com/remorses/playwriter) by Tommaso De Rossi — The project that started it all. RunBrowser began as a fork of playwriter and owes its Chrome extension architecture to Tommaso's original design.
- [bb-browser](https://github.com/epiral/bb-browser) & [bb-sites](https://github.com/epiral/bb-sites) — A beautifully designed browser automation tool with an impressive collection of 45+ community site adapters. The bb-sites ecosystem is a constant source of inspiration.
- [agent-browser](https://github.com/vercel-labs/agent-browser) by Vercel — Pioneered many ideas around comprehensive browser CLIs for AI agents.

Thank you to all these maintainers for pushing browser automation forward.

## License

MIT
