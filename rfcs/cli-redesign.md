# RFC: RunBrowser CLI Redesign

> Make RunBrowser's CLI the best browser automation CLI for AI agents.

## Design Principles

1. **Flat hot path** — The 15 commands agents use 95% of the time stay flat. One word = one action.
2. **Subgroups for domains** — Management, info queries, and feature clusters get proper subcommands.
3. **No bloat** — Every command must earn its place. If `eval` can do it and it's rare, don't add a command.
4. **"Your browser" advantage** — Tab management, cookie reading, and credential brokering are first-class because they leverage our unique position.
5. **Agent-optimized** — Short commands save tokens. `@ref` is the primary interaction model. `--json` on everything.

## Why Better Than Agent-Browser

| Aspect | agent-browser | RunBrowser |
|--------|--------------|------------|
| Command count | ~90 (bloated) | ~45 (focused) |
| Browser model | Spawns headless Chromium | **Your running Chrome** |
| Auth story | Auth vault (stores passwords) | **Credential broker** (agent never sees passwords) |
| Session UX | Manual session management required | **Auto-session** (just works) |
| Tab management | `tab new/list/close` on spawned browser | `tab` on **real tabs the user sees** |
| Cookie access | Full read/write on empty browser | **Read existing cookies** (leverage real logins) |
| `--help` | Overwhelming wall of text | Scannable categories |
| CLI binary | Rust CLI → Node daemon (2 processes) | Node CLI → relay → extension (clean pipeline) |
| Selector model | CSS + refs + semantic locators | `@ref` primary, CSS fallback, `find` for semantic |
| Diff support | ✅ snapshot + screenshot + URL | ✅ snapshot diff |
| iOS support | ✅ via Appium | ❌ (not our focus) |
| Bot detection | Always detected (headless) | **Bypasses** (user's real browser) |

## Complete Command Reference

### Flat Commands (Hot Path)

```bash
# Navigation
open <url>                      # Navigate (aliases: goto, navigate)
back                            # History back
forward                         # History forward
reload                          # Reload page
close                           # Close session (aliases: quit, exit)

# Observation
snapshot                        # Accessibility tree with @refs
screenshot [path]               # Take screenshot

# Interaction
click <ref>                     # Click element by @ref
dblclick <ref>                  # Double-click element
fill <ref> <value>              # Clear + fill input
type <text>                     # Type at current focus
press <key>                     # Press key (Enter, Tab, Escape, ...)
select <ref> <value>            # Select dropdown option
check <ref>                     # Check checkbox
uncheck <ref>                   # Uncheck checkbox
scroll <dir> [amount]           # Scroll up/down/left/right
hover <ref>                     # Hover element
focus <ref>                     # Focus element
upload <ref> <files...>         # Upload files
drag <src> <dst>                # Drag and drop

# Wait (polymorphic — one command, many modes)
wait <ref|ms>                   # Wait for element visible or time
wait --text "Welcome"           # Wait for text to appear
wait --url "**/dashboard"       # Wait for URL pattern
wait --load networkidle         # Wait for load state
wait --fn "window.ready"        # Wait for JS condition

# Escape hatches
eval <code>                     # Run JavaScript in browser context
cdp <method> [params]           # Raw Chrome DevTools Protocol
```

### Subgrouped Commands

```bash
# ── get: query info from elements or page ──────────────────
get text <ref>                  # Get text content
get html <ref>                  # Get innerHTML
get value <ref>                 # Get input value
get attr <ref> <name>           # Get attribute
get url                         # Get current URL
get title                       # Get page title
get count <selector>            # Count matching elements       [NEW]

# ── is: check element state ────────────────────────────────
is visible <ref>                # Check if visible
is checked <ref>                # Check if checked
is enabled <ref>                # Check if enabled              [NEW]

# ── find: semantic locators with chained action ────────────  [NEW]
find role <role> <action> [val] # By ARIA role (--name, --exact)
find text <text> <action>       # By text content
find label <label> <action> [val] # By label
find placeholder <ph> <action> [val] # By placeholder
find testid <id> <action> [val] # By data-testid
find first <sel> <action> [val] # First match
find nth <n> <sel> <action> [val] # Nth match
#   actions: click, fill, type, hover, focus, check, uncheck, text

# ── tab: manage real browser tabs ──────────────────────────  [NEW]
tab                             # List open tabs
tab new [url]                   # Open new tab
tab <n>                         # Switch to tab n
tab close [n]                   # Close tab

# ── frame: iframe navigation ──────────────────────────────  [NEW]
frame <selector>                # Switch to iframe
frame main                      # Back to main frame

# ── diff: compare snapshots ───────────────────────────────  [NEW]
diff snapshot                   # Diff current vs last snapshot
diff snapshot --baseline <file> # Diff current vs saved file
diff screenshot --baseline <f>  # Visual pixel diff

# ── session: manage sessions ──────────────────────────────
session new [--browser <key>]   # Create session
session list                    # List active sessions
session delete <id>             # Delete session

# ── password: credential broker ──────────────────────────────
password login <domain>             # Securely log in (agent never sees password)
password list <domain>              # List available credentials
password status                     # Show broker status
password detect                     # Detect login forms on current page

# ── config: persistent settings ──────────────────────────
config set <key> <value>        # Set config value
config unset <key>              # Remove config value
config show                     # Show current config

# ── Utilities ────────────────────────────────────────────
serve [--host] [--token]        # Start relay server
logfile                         # Print log file paths
skill                           # Print agent usage instructions
```

## Snapshot Options

```bash
snapshot                        # Full tree
snapshot -i                     # Interactive elements only
snapshot -c                     # Compact (remove empty containers)
snapshot -d <n>                 # Limit depth
snapshot -s <selector>          # Scope to CSS selector
snapshot -i -c -d 5             # Combine options
```

## Screenshot Options

```bash
screenshot                      # Capture to stdout info
screenshot page.png             # Save to file
screenshot --full               # Full page
screenshot --annotate           # Numbered labels on elements
screenshot @e3 page.png         # Scope to element
```

## What We Intentionally Do NOT Add

These exist in agent-browser but don't belong in RunBrowser:

| Command | Why not |
|---------|---------|
| `install` | We use the user's Chrome. No browser to install. |
| `set device/geo/offline/media` | This is the user's real browser. Don't mess with their settings. |
| `trace/profiler/har` | Too specialized. Use `cdp` for raw protocol access. |
| `network route/unroute` | Complex. Use `eval` to set up interceptors. |
| `cookies set/clear` | Modifying the user's real cookies is dangerous. Read-only access is safer. |
| `storage set/clear` | Same — don't modify user's real storage. |
| `state save/load` | Different model — the user's browser IS the persistent state. |
| `mouse move/down/up/wheel` | Too low-level. `click`, `hover`, `scroll` cover 99% of cases. |
| `keyboard type/inserttext` | `type` and `press` already cover this. |
| `highlight` | Niche debugging. Use `eval` to inject styles. |
| `pdf` | Niche. Use `cdp Page.printToPDF`. |
| `viewport` as flat | Moved to `set viewport` only if we add more `set` commands. Keep flat for now since it's the only browser setting we expose. |

## `--help` Output

```
runbrowser v0.1.0 — Control your running Chrome browser

Browser actions:
  open <url>              Navigate to URL (aliases: goto, navigate)
  click <ref>             Click element by @ref
  dblclick <ref>          Double-click element
  fill <ref> <value>      Clear + fill input
  type <text>             Type at current focus
  press <key>             Press key (Enter, Tab, Escape, ...)
  select <ref> <value>    Select dropdown option
  check / uncheck <ref>   Toggle checkbox
  scroll <dir> [amount]   Scroll up/down/left/right
  hover <ref>             Hover element
  focus <ref>             Focus element
  upload <ref> <files>    Upload files
  drag <src> <dst>        Drag and drop
  snapshot                Accessibility tree with @refs (-i -c -d -s)
  screenshot [path]       Take screenshot (--full, --annotate)
  wait <ref|ms|flags>     Wait for element, time, text, URL, load, JS
  eval <code>             Run JavaScript in page context
  cdp <method> [params]   Raw Chrome DevTools Protocol command
  back / forward / reload Navigation history
  close                   Close session (aliases: quit, exit)

Subcommands:
  get <what> [ref]        text, html, value, attr, url, title, count
  is <check> <ref>        visible, checked, enabled
  find <by> <action>      role, text, label, placeholder, testid, first, nth
  tab [cmd]               list, new, switch, close (manage real tabs)
  frame <sel|main>        Switch to iframe or back to main
  diff <type>             snapshot, screenshot (compare states)
  session <cmd>           new, list, delete
  password <cmd>              login, list, status, detect
  config <cmd>            set, unset, show

Utilities:
  serve                   Start relay server (--host, --token)
  viewport <w> <h>        Set viewport size
  logfile                 Print log file paths
  skill                   Print full usage instructions

Global options:
  -s, --session <id>      Session ID (auto-created if omitted)
  --host <host>           Remote relay host
  --token <token>         Auth token
  --json                  JSON output for all commands
```

## Migration from Current CLI

| Current | New | Breaking? |
|---------|-----|-----------|
| `open <url>` | `open <url>` | No |
| `navigate <url>` | `open <url>` (alias kept) | No |
| `session-new` | `session new` | Yes |
| `session-list` | `session list` | Yes |
| `session-delete <id>` | `session delete <id>` | Yes |
| `config-set` | `config set` | Yes |
| `config-unset` | `config unset` | Yes |
| `config-show` | `config show` | Yes |
| `login <domain>` | `password login <domain>` | Yes |
| `credentials <domain>` | `password list <domain>` | Yes |
| `credential-status` | `password status` | Yes |
| `detect-forms` | `password detect` | Yes |
| `get-url` | `get url` | Already works |
| `get-title` | `get title` | Already works |

## Agent Workflow (Optimal Pattern)

```bash
# 1. Auto-session created on first command
runbrowser open https://example.com

# 2. Get interactive elements
runbrowser snapshot -i

# 3. Interact via refs
runbrowser fill @e3 "hello@example.com"
runbrowser click @e5

# 4. Re-snapshot after page change
runbrowser snapshot -i

# 5. Chain commands for speed
runbrowser fill @e1 "user" && runbrowser fill @e2 "pass" && runbrowser click @e3

# 6. Semantic locators when refs aren't available
runbrowser find role button click --name "Submit"

# 7. Credential broker for secure login
runbrowser password login github.com

# 8. Tab management on real browser
runbrowser tab new https://docs.example.com
runbrowser tab 0    # switch back to first tab
```

## New API Methods Needed in RelayApiClient

```typescript
// Missing from current api-client.ts:
dblclick(sessionId, ref): Promise<void>
check(sessionId, ref): Promise<void>
uncheck(sessionId, ref): Promise<void>
focus(sessionId, ref): Promise<void>
upload(sessionId, ref, files: string[]): Promise<void>
drag(sessionId, src, dst): Promise<void>
isEnabled(sessionId, ref): Promise<{ enabled: boolean }>
getCount(sessionId, selector): Promise<{ count: number }>

// Tab management:
listTabs(sessionId): Promise<{ tabs: Tab[] }>
newTab(sessionId, url?): Promise<{ index: number }>
switchTab(sessionId, index): Promise<void>
closeTab(sessionId, index?): Promise<void>

// Frame management:
switchFrame(sessionId, selector): Promise<void>
switchToMainFrame(sessionId): Promise<void>

// Find + action:
findAndAct(sessionId, by, value, action, actionValue?, options?): Promise<unknown>

// Diff:
diffSnapshot(sessionId, baseline?): Promise<{ diff: string }>
diffScreenshot(sessionId, baseline, output?): Promise<{ path: string }>

// Close:
close(sessionId): Promise<void>

// Enhanced snapshot:
snapshot(sessionId, options?: {
  interactiveOnly?: boolean
  compact?: boolean
  maxDepth?: number
  selector?: string
}): Promise<{ snapshot: string; refs: unknown[] }>

// Enhanced screenshot:
captureScreenshot(sessionId, options?: {
  path?: string
  fullPage?: boolean
  annotate?: boolean
  selector?: string
}): Promise<{ data: string; mimeType: string; annotations?: Annotation[] }>
```

## Implementation Order

### Phase 1: Subgroup restructuring (breaking changes)
- Convert `session-*` → `session` subgroup
- Convert `config-*` → `config` subgroup
- Convert credential commands → `password` subgroup
- Add `close` command
- Add command aliases (`goto`/`navigate` for `open`)

### Phase 2: Missing basic interactions
- Add `dblclick`, `check`, `uncheck`, `focus`, `upload`, `drag`
- Add `is enabled`, `get count`
- Enhance `snapshot` with `-i`, `-c`, `-d`, `-s` options
- Enhance `screenshot` with `--full`, `--annotate`

### Phase 3: Tab and frame management
- Implement `tab` subgroup (list, new, switch, close)
- Implement `frame` subgroup (switch, main)

### Phase 4: Advanced features
- Implement `find` semantic locator subgroup
- Implement `diff` subgroup
- Add `--annotate` screenshot labeling with ref mapping

## Command Count Comparison

| CLI | Flat | Subgrouped | Total |
|-----|------|-----------|-------|
| **RunBrowser (current)** | 22 | 5 (poorly organized) | 27 |
| **RunBrowser (proposed)** | 22 | 23 | **45** |
| **Playwriter** | 3 | 5 | 8 |
| **Agent-browser** | 35 | 55+ | **90+** |

RunBrowser hits the sweet spot: comprehensive enough for any task, organized enough to be learnable, focused enough to avoid bloat.
