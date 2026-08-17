# termio browser

> Control your browser via CDP. Extension + CLI, no wrapper layer.

Other Browser Automation spawn a fresh Chrome — no logins, no extensions, instantly flagged by bot detectors, double the memory. termio browser connects to **your running browser** instead. One Chrome extension, full CDP access, everything you're already logged into.

|               | Playwright MCP    | termio browser                        |
| ------------- | ----------------- | --------------------------------- |
| Browser       | Spawns new Chrome | **Uses your Chrome**              |
| Extensions    | None              | Your existing ones                |
| Login state   | Fresh             | Already logged in                 |
| Bot detection | Always detected   | Can bypass (disconnect extension) |
| Collaboration | Separate window   | Same browser as user              |

## Quick Start

```bash
# 1. Install the CLI
npm i -g @termio/browser

# 2. Load extension: chrome://extensions/ → Developer mode → Load unpacked → packages/extension/dist
# 3. Click the extension icon on a tab — it turns green

# 4. Use it
termio-browser status
termio-browser tab new https://example.com
termio-browser eval 'document.title'
termio-browser cdp Accessibility.getFullAXTree | jq '.nodes[] | select(.role.value=="button")'
```

### Add the Skill to Your Agent

```bash
termio-browser skill install              # → ./.claude/skills and ./.agents/skills
termio-browser skill install --global     # → ~/.claude/skills and ~/.agents/skills
```

Installs into the current project by default, so the skill is committed and
reviewed alongside the code it is used on; `--global` (`-g`) installs into
`$HOME` instead. Re-running is safe, and a `SKILL.md` you have edited yourself
is never overwritten — remove it first if you want ours back. `termio-browser skill
uninstall` removes only files we installed.

This teaches your agent the CDP patterns that matter: read the accessibility tree before acting, filter it before printing, poll instead of sleeping.

## How It Works

termio browser uses the **Chrome DevTools Protocol (CDP)** directly. The extension bridges CDP commands over WebSocket to your running browser.

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   BROWSER           │     │   LOCALHOST          │     │   CLIENT        │
│                     │     │                      │     │                 │
│  ┌───────────────┐  │     │ WebSocket Server     │     │  ┌───────────┐  │
│  │   Extension   │<───────┬───>  :8790          │     │  │ CLI / MCP │  │
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

Two commands touch a page. Everything you might expect as a verb — click, type,
read, screenshot, wait — is a CDP method, so it goes through `cdp`.

```bash
termio-browser cdp <Method> [params-json]    # the page API
termio-browser eval '<js>'                   # shorthand for Runtime.evaluate
termio-browser tab list|new|switch|close      # which target you're bound to
termio-browser status                        # is a browser attached
termio-browser session new|list|delete       # isolated state, one per agent
```

Why no `click`/`snapshot`/`@ref` layer: every wrapper is an abstraction someone
decided the model needs, and it becomes a constraint the model has to work
around. Chrome's protocol is complete and documented, and LLMs were trained on
it. The wrapper layer was removed rather than maintained.

Navigation and screenshots are single CDP methods. Clicking and typing are short
CDP sequences — `termio-browser skill` documents them, including the parts a `click`
verb used to hide (scroll into view, no actionability check, `keyUp` pairing).

### The page API

```bash
termio-browser cdp Page.navigate '{"url":"https://example.com"}'
termio-browser cdp Accessibility.getFullAXTree | jq '.nodes[] | select(.role.value=="button")'
termio-browser cdp Input.dispatchMouseEvent '{"type":"mousePressed","x":420,"y":310,"button":"left","clickCount":1}'
termio-browser cdp Page.captureScreenshot | jq -r .data | base64 -d > shot.png
```

Both `cdp` and `eval` accept their payload on stdin, which is easier than
quoting multi-line JS in a shell:

```bash
termio-browser eval <<'JS'
Array.from(document.querySelectorAll('a')).map(a => a.href)
JS
```

### Reading a page

Use the accessibility tree, not screenshots — it is text, so you can filter it
with `jq`, and it costs a fraction of the tokens. Filter before printing; a real
page is thousands of nodes.

```bash
termio-browser cdp Accessibility.getFullAXTree \
  | jq '.nodes[] | select(.role.value=="button") | {name: .name.value, id: .backendDOMNodeId}'
```

### Tabs and sessions

Tabs are shared across sessions; session state is not. Several agents can work
in one browser without colliding.

```bash
termio-browser tab new https://example.com   # opens and binds to it
termio-browser tab list                      # → marks the bound tab
termio-browser session new                   # → prints an id
termio-browser -s 3 tab list                 # act inside session 3
```

### Command Extensions

Site commands from the [runbrowser/commands](https://github.com/runbrowser/commands)
repo are unchanged — they are a different audience from the agent CDP path.

```bash
termio-browser commands list
termio-browser commands install reddit
```

### Configuration

```bash
termio-browser config set <key> <value>   # set token, host, etc.
termio-browser config unset <key>         # remove a config value
termio-browser config show                # show current config
termio-browser logfile                    # print log file paths
termio-browser skill                      # print full agent instructions
```

## MCP Setup

The CLI is the recommended way to use termio browser. For MCP server integration:

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["-y", "@termio/browser-mcp@latest"]
    }
  }
}
```

MCP tools: `cdp`, `eval`, `tab`, `status`, `skill`, `command`.

For full MCP instructions, see [MCP.md](./MCP.md).

## Remote Access

Control Chrome on a remote machine — headless Mac mini, cloud VM, devcontainer:

```bash
# On the host machine
termio-browser serve --host 0.0.0.0 --token <secret>

# From anywhere
export TERMIO_BROWSER_HOST=192.168.1.10
export TERMIO_BROWSER_TOKEN=<secret>
termio-browser navigate https://example.com -s 1
```

For Docker/devcontainers, use `TERMIO_BROWSER_HOST=host.docker.internal`.

## Playwright API (Optional)

The relay exposes a standard CDP WebSocket endpoint for Playwright:

```typescript
import { chromium } from 'playwright-core'
import { starttermio browserCDPRelayServer, getCdpUrl } from '@termio/browser-server'

const server = await starttermio browserCDPRelayServer()
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
| `TERMIO_BROWSER_HOST` | Remote relay server host |
| `TERMIO_BROWSER_TOKEN` | Authentication token |
| `TERMIO_BROWSER_PORT` | Relay server port (default: 8790) |
| `TERMIO_BROWSER_SESSION` | Default session ID (avoids `-s` flag) |
| `TERMIO_BROWSER_AUTO_ENABLE` | Auto-create tab on connect |
| `TERMIO_BROWSER_LOG_FILE_PATH` | Custom path for relay server log file |
| `TERMIO_BROWSER_CDP_LOG_FILE_PATH` | Custom path for CDP JSONL log file |

## Project Structure

```
packages/
├── cli/          # @termio/browser — CLI
├── server/       # @termio/browser-server — WebSocket relay, CDP bridge, site commands
├── mcp/          # @termio/browser-mcp — MCP server (thin HTTP wrapper)
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

- **Local only** — WebSocket server binds to `localhost:8790`
- **Origin validation** — only the termio browser extension origin is accepted
- **Explicit consent** — only tabs where you clicked the extension icon
- **Visible automation** — Chrome shows an automation banner on controlled tabs

## Troubleshooting

```bash
termio-browser logfile  # prints log file paths
# relay: ~/.termio/browser/relay-server.log
# cdp:   ~/.termio/browser/cdp.jsonl
```

| Problem | Fix |
|---|---|
| Extension icon stays gray | Click it again. Check `chrome://extensions/` for errors. |
| "Extension not connected" | Click extension icon on at least one tab. |
| All pages return `about:blank` | Restart Chrome (known Chrome bug). |
| Port 8790 in use | `lsof -ti :8790 \| xargs kill` |

## Acknowledgements

termio browser wouldn't exist without the work of these projects and their maintainers.

- [playwriter](https://github.com/remorses/playwriter) by Tommaso De Rossi — The project that started it all. termio browser began as a fork of playwriter and owes its Chrome extension architecture to Tommaso's original design.
- [bb-browser](https://github.com/epiral/bb-browser) & [bb-sites](https://github.com/epiral/bb-sites) — A beautifully designed browser automation tool with an impressive collection of 45+ community site adapters. The bb-sites ecosystem is a constant source of inspiration.
- [agent-browser](https://github.com/vercel-labs/agent-browser) by Vercel — Pioneered many ideas around comprehensive browser CLIs for AI agents.
- [pi](https://github.com/badlogic/pi-mono) by Mario Zechner — The command extensions system (`termio-browser commands install/list/uninstall`) was inspired by pi's elegant approach to extensibility and package management.

Thank you to all these maintainers for pushing the ecosystem forward.

## License

MIT
