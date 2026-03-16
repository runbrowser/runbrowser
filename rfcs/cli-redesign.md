# RFC: RunBrowser CLI Design

> Status: **Implemented** (2026-03-15)

## Design Principles

1. **Flat hot path** — The 20+ commands agents use most stay flat. One word = one action.
2. **Subgroups for domains** — Management, info queries, and feature clusters get proper subcommands.
3. **No bloat** — Every command must earn its place. If `eval` can do it and it's rare, don't add a command.
4. **"Your browser" advantage** — Tab management and real-browser features are first-class.
5. **Agent-optimized** — Short commands save tokens. `@ref` is the primary interaction model. `--json` on everything.
6. **Auto-session** — Session is auto-created on first command. No mandatory `-s` flag.

## Architecture

### Hand-Written Argument Parser (Two-Phase)

The CLI uses a **hand-written argument parser** (`args.ts`) instead of `cac` or `yargs`. This was chosen for:

- **Two-phase flag resolution**: Phase 1 parses known flags, stashes unknown flags. Phase 2 (future) resolves extension-registered flags.
- **No dependency bloat**: Zero external parser dependencies.
- **Full control**: Custom `@ref` handling, subcommand detection, variadic positionals.

```
Phase 1: Parse known flags (global + command-specific)
  ↓
Phase 2 (future): Re-resolve unknown flags from extension registry
```

### Command Registry

Commands are defined as `CommandDef` objects with metadata for auto-generated `--help`:

```typescript
interface CommandDef {
  name: string
  aliases?: string[]
  description: string
  positionals?: PositionalDef[]
  flags?: Record<string, FlagDef>
}
```

Commands self-register via `registerBuiltinCommand()` in category files:
- `commands/navigation.ts` — navigate, back, forward, reload, close
- `commands/observation.ts` — snapshot, screenshot, get, is
- `commands/interaction.ts` — click, dblclick, fill, type, press, select, check, uncheck, scroll, hover, focus, upload, drag, viewport, wait, find, tab, frame
- `commands/execution.ts` — eval, cdp, diff
- `commands/management.ts` — session, config, serve, logfile, skill
- `commands/recording.ts` — record (start, stop, status, cancel)

### Auto-Session

The `resolveSession()` function auto-creates sessions:

1. If `--session` or `RUNBROWSER_SESSION` is set → use that session
2. If sessions exist → reuse the first one
3. If no sessions → wait for extension → create a new session

This means agents can start with `runbrowser navigate https://example.com` — no setup.

### Output Formatting

All commands support:
- `--json` for structured JSON output
- `--format table|json|csv|md|yaml` for tabular data (site commands)
- Plain text for human-readable output

## Complete Command Reference

### Flat Commands (Hot Path)

```bash
# Navigation
navigate <url>                  # Navigate (aliases: open, goto)
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
viewport <w> <h>                # Set viewport size

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
# ── get: query info from elements or page ──
get text <ref>                  # Get text content
get html <ref>                  # Get innerHTML
get value <ref>                 # Get input value
get attr <ref> --attr-name <n>  # Get attribute
get url                         # Get current URL
get title                       # Get page title
get count <selector>            # Count matching elements

# ── is: check element state ──
is visible <ref>                # Check if visible
is checked <ref>                # Check if checked
is enabled <ref>                # Check if enabled

# ── find: semantic locators with chained action ──
find role <role> <action> [val] # By ARIA role (--name, --exact)
find text <text> <action>       # By text content
find label <label> <action>     # By label
find placeholder <ph> <action>  # By placeholder
find testid <id> <action>       # By data-testid

# ── tab: manage real browser tabs ──
tab                             # List open tabs
tab new [url]                   # Open new tab
tab <n>                         # Switch to tab n
tab close [n]                   # Close tab

# ── frame: iframe navigation ──
frame <selector>                # Switch to iframe
frame main                      # Back to main frame

# ── diff: compare states ──
diff snapshot                   # Diff current vs last snapshot
diff screenshot --baseline <f>  # Visual pixel diff

# ── record: video recording ──
record start -o <path>          # Start recording (MP4)
record stop                     # Stop and save
record status                   # Check if recording
record cancel                   # Cancel without saving

# ── session: manage sessions ──
session new [--browser <key>]   # Create session
session list                    # List active sessions
session delete <id>             # Delete session

# ── config: persistent settings ──
config set <key> <value>        # Set config value
config unset <key>              # Remove config value
config show                     # Show current config

# ── commands: manage command packages ──
commands list                   # List available packages
commands install <package>      # Install community commands
commands uninstall <package>    # Remove installed commands

# ── Utilities ──
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
snapshot -S <selector>          # Scope to CSS selector
```

## Global Options

```
-s, --session <id>      Session ID (auto-created if omitted)
--host <host>           Remote relay host (or RUNBROWSER_HOST)
--token <token>         Auth token (or RUNBROWSER_TOKEN)
--json                  JSON output
-f, --format <fmt>      Output format: table, json, csv, md, yaml
-h, --help              Show help
-v, --version           Show version
```

## `--help` Output

```
runbrowser v0.0.6 — Control your running Chrome browser

Usage: runbrowser <command> [options]

Navigation:
  navigate (open, goto)              Navigate to a URL
  back                               Go back in history
  forward                            Go forward in history
  reload                             Reload the page
  close (quit, exit)                 Close browser session

Observation:
  snapshot                           Accessibility snapshot with @refs
  screenshot                         Take a screenshot
  get                                Get info: text, html, value, attr, url, title, count
  is                                 Check element state: visible, checked, enabled

Interaction:
  click                              Click an element by @ref
  dblclick                           Double-click an element
  fill                               Clear and fill an input
  type                               Type text at current focus
  press                              Press a key
  select                             Select a dropdown option
  check / uncheck                    Toggle checkbox
  scroll                             Scroll the page
  hover                              Hover over an element
  focus                              Focus an element
  upload                             Upload files
  drag                               Drag source to target
  viewport                           Set viewport size
  wait                               Wait for element, time, text, URL, load, JS
  find                               Find by semantic locator and act
  tab                                Manage browser tabs
  frame                              Switch to iframe

Execution:
  eval                               Run JavaScript in browser context
  cdp                                Raw CDP command

Session:
  session                            Manage sessions: new, list, delete

Config:
  config                             Manage config: set, unset, show

Commands:
  commands                           Manage command packages: list, install, uninstall

Server:
  serve                              Start the relay server
  logfile                            Print log file paths
  skill                              Print full usage instructions
  diff                               Compare states: snapshot, screenshot
  record                             Video recording: start, stop, status, cancel
```

## What We Intentionally Do NOT Add

| Command | Why not |
|---------|---------|
| `install` (flat) | Ambiguous — install what? Browser? Commands? Use `commands install` instead. |
| `set device/geo/offline/media` | This is the user's real browser. Don't mess with their settings. |
| `trace/profiler/har` | Too specialized. Use `cdp` for raw protocol access. |
| `cookies set/clear` | Modifying the user's real cookies is dangerous. |
| `storage set/clear` | Same — don't modify user's real storage. |
| `mouse move/down/up/wheel` | Too low-level. `click`, `hover`, `scroll` cover 99% of cases. |
| `exec` (Playwright) | Playwright is removed. `eval` runs JS in browser context. `cdp` for raw CDP. |

## Implementation Notes

### Visual Feedback

Every interaction command triggers visual feedback in the browser:
- **Page border flash** — brief green border glow on the page
- **Element highlight** — target element gets a green outline pulse

This makes it easy for users to see what the agent is doing in real time.

### Cross-Origin Navigation

Navigate handles cross-origin navigations (e.g., `about:blank` → `https://example.com`) where Chrome detaches and re-attaches the debugging target. The `waitForReattach` mechanism in `CDPExecutor` handles this transparently.

### Site Command Dispatch

When a command doesn't match any built-in, the CLI tries it as a site command:

```
runbrowser github trending --limit 5
         ↓
command = "github", subcommand = "trending"
         ↓
POST /api/command/run { sessionId, site: "github", name: "trending", args: { limit: 5 } }
         ↓
Relay loads ~/.runbrowser/commands/github/trending.ts via jiti
         ↓
Returns structured data → formatted as table/json/csv/md
```

## Comparison

| CLI | Flat | Subgrouped | Total |
|-----|------|-----------|-------|
| **RunBrowser** | 22 | 28 | **~50** |
| **Playwriter** | 3 | 5 | 8 |
| **Agent-browser** | 35 | 55+ | **90+** |
