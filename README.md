# RunBrowser

> Control your browser via CDP. Extension + CLI, no wrapper layer.

Other Browser Automation spawn a fresh Chrome — no logins, no extensions, instantly flagged by bot detectors, double the memory. RunBrowser connects to **your running browser** instead. One Chrome extension, full CDP access, everything you're already logged into.

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
npm i -g runbrowser

# 2. Load extension: chrome://extensions/ → Developer mode → Load unpacked → packages/extension/dist
# 3. Click the extension icon on a tab — it turns green

# 4. Use it
runbrowser status
runbrowser tab new https://example.com
runbrowser eval 'document.title'
runbrowser cdp Accessibility.getFullAXTree | jq '.nodes[] | select(.role.value=="button")'
```

### Add the Skill to Your Agent

```bash
runbrowser skill install              # → ./.claude/skills and ./.agents/skills
runbrowser skill install --global     # → ~/.claude/skills and ~/.agents/skills
```

Installs into the current project by default, so the skill is committed and
reviewed alongside the code it is used on; `--global` (`-g`) installs into
`$HOME` instead. Re-running is safe, and a `SKILL.md` you have edited yourself
is never overwritten — remove it first if you want ours back. `RunBrowser skill
uninstall` removes only files we installed.

This teaches your agent the CDP patterns that matter: read the accessibility tree before acting, filter it before printing, poll instead of sleeping.

## How It Works

RunBrowser uses the **Chrome DevTools Protocol (CDP)** directly. The extension bridges CDP commands over WebSocket to your running browser.

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
runbrowser cdp <Method> [params-json]    # the page API
runbrowser eval '<js>'                   # shorthand for Runtime.evaluate
runbrowser tab list|new|switch|close      # which target you're bound to
runbrowser status                        # is a browser attached
runbrowser session new|list|delete       # isolated state, one per agent
```

Why no `click`/`snapshot`/`@ref` layer: every wrapper is an abstraction someone
decided the model needs, and it becomes a constraint the model has to work
around. Chrome's protocol is complete and documented, and LLMs were trained on
it. The wrapper layer was removed rather than maintained.

Navigation and screenshots are single CDP methods. Clicking and typing are short
CDP sequences — `runbrowser skill` documents them, including the parts a `click`
verb used to hide (scroll into view, no actionability check, `keyUp` pairing).

### The page API

```bash
runbrowser cdp Page.navigate '{"url":"https://example.com"}'
runbrowser cdp Accessibility.getFullAXTree | jq '.nodes[] | select(.role.value=="button")'
runbrowser cdp Input.dispatchMouseEvent '{"type":"mousePressed","x":420,"y":310,"button":"left","clickCount":1}'
runbrowser cdp Page.captureScreenshot | jq -r .data | base64 -d > shot.png
```

Both `cdp` and `eval` accept their payload on stdin, which is easier than
quoting multi-line JS in a shell:

```bash
runbrowser eval <<'JS'
Array.from(document.querySelectorAll('a')).map(a => a.href)
JS
```

### Reading a page

Use the accessibility tree, not screenshots — it is text, so you can filter it
with `jq`, and it costs a fraction of the tokens. Filter before printing; a real
page is thousands of nodes.

```bash
runbrowser cdp Accessibility.getFullAXTree \
  | jq '.nodes[] | select(.role.value=="button") | {name: .name.value, id: .backendDOMNodeId}'
```

### Tabs and sessions

Tabs are shared across sessions; session state is not. Several agents can work
in one browser without colliding.

```bash
runbrowser tab new https://example.com   # opens and binds to it
runbrowser tab list                      # → marks the bound tab
runbrowser session new                   # → prints an id
runbrowser -s 3 tab list                 # act inside session 3
```

### Plugins

144 plugins across 50 sites ship with RunBrowser. A plugin is a `@meta` JSON
header and a bare async function, evaluated *in the page* — one round trip, with
that site's cookies, origin and its own JavaScript available.

```bash
runbrowser plugin list
runbrowser plugin install reddit
runbrowser plugin install <site> --repo owner/name   # anyone's repository
```

The format and the bundled corpus come from
[bb-sites](https://github.com/epiral/bb-sites). Reading that format rather than
inventing one means a plugin written for either runs on both.

### Configuration

```bash
runbrowser config set <key> <value>   # set token, host, etc.
runbrowser config unset <key>         # remove a config value
runbrowser config show                # show current config
runbrowser logfile                    # print log file paths
runbrowser skill                      # print full agent instructions
```

## MCP Setup

The CLI is the recommended way to use runbrowser. For MCP server integration:

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["-y", "runbrowser@latest"]
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
import { startRunBrowserCDPRelayServer, getCdpUrl } from 'runbrowser'

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
| `RUNBROWSER_PORT` | Relay server port (default: 8790) |
| `RUNBROWSER_SESSION` | Default session ID (avoids `-s` flag) |
| `RUNBROWSER_AUTO_ENABLE` | Auto-create tab on connect |
| `RUNBROWSER_LOG_FILE_PATH` | Custom path for relay server log file |
| `RUNBROWSER_CDP_LOG_FILE_PATH` | Custom path for CDP JSONL log file |

## Project Structure

```
packages/
├── cli/          # runbrowser — CLI
├── server/       # runbrowser — WebSocket relay, CDP bridge, site commands
├── mcp/          # runbrowser — MCP server (thin HTTP wrapper)
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
| Port 8790 in use | `lsof -ti :8790 \| xargs kill` |

## Acknowledgements

RunBrowser wouldn't exist without the work of these projects and their maintainers.

- [playwriter](https://github.com/remorses/playwriter) by Tommaso De Rossi — The project that started it all. RunBrowser began as a fork of playwriter and owes its Chrome extension architecture to Tommaso's original design.
- [agent-browser](https://github.com/vercel-labs/agent-browser) by Vercel — Pioneered many ideas around comprehensive browser CLIs for AI agents.
- [pi](https://github.com/badlogic/pi-mono) by Mario Zechner — The plugins system (`runbrowser plugin install/list/uninstall`) was inspired by pi's elegant approach to extensibility and package management.

Thank you to all these maintainers for pushing the ecosystem forward.

## License

MIT
