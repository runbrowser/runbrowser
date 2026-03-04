# RunBrowser Refactoring Plan: Drop Playwright, Use Direct CDP

## Goal

Remove Playwright dependency. Execute browser commands directly through the Relay Server → Extension → `chrome.debugger` (CDP) chain that already exists. The Relay Server becomes the execution engine (equivalent to agent-browser's "native daemon").

## Current Architecture (Before)

```
MCP/CLI
  → HTTP → Relay Server
    → PlaywrightExecutor (packages/core/src/executor.ts)
      → chromium.connectOverCDP()
        → Relay Server CDP WebSocket endpoint
          → Extension WebSocket
            → chrome.debugger.sendCommand (CDP)
              → Chrome Tab
```

**Problem:** Playwright connects BACK to the Relay Server, which then forwards to the Extension. The Relay already talks to the Extension directly — Playwright is a pointless middleman creating a circular connection.

## Target Architecture (After)

```
MCP/CLI
  → HTTP → Relay Server
    → CDPExecutor (new, in packages/relay)
      → Extension WebSocket (already exists)
        → chrome.debugger.sendCommand (CDP)
          → Chrome Tab
```

**Plus high-level MCP tools:**

```
MCP Tools:                     Relay Server:              Extension → Chrome:
  navigate(url)          →       Page.navigate          →   chrome.debugger
  click(ref)             →       Runtime.evaluate + Input →  chrome.debugger
  fill(ref, value)       →       Runtime.evaluate + Input →  chrome.debugger
  snapshot()             →       Accessibility.getFullAXTree → chrome.debugger
  screenshot()           →       Page.captureScreenshot  →   chrome.debugger
  evaluate(code)         →       Runtime.evaluate        →   chrome.debugger (simple & complex)
```

---

## Phase 0: Preparation

**Goal:** Understand the boundary, set up infrastructure.

### 0.1 Document the CDP commands the Extension already supports
- File: `packages/extension/src/background.ts`
- The `handleCommand` function (line ~867) processes `forwardCDPCommand`
- All CDP methods are forwarded via `chrome.debugger.sendCommand`
- Special handling: `Target.setAutoAttach`, `Runtime.enable`, `Target.createTarget`, `Target.closeTarget`
- **Output:** A list of CDP capabilities available through the Extension

### 0.2 Document what the Relay Server already provides
- File: `packages/relay/src/server.ts`
- `sendToExtension()` (line ~413) — sends CDP commands to Extension via WebSocket
- Already has session management, CDP WebSocket proxy, HTTP API
- **Key insight:** `sendToExtension({ method: 'forwardCDPCommand', params: { method, params, sessionId } })` is the primitive we build on

### 0.3 Create test infrastructure
- Add integration tests that send CDP commands through Relay → Extension → Chrome
- Verify basic CDP operations work without Playwright: `Runtime.evaluate`, `Page.navigate`, `Page.captureScreenshot`

---

## Phase 1: Build CDPExecutor in Relay

**Goal:** Create a new executor that sends CDP commands directly through the Extension, replacing `PlaywrightExecutor`.

### 1.1 Create `packages/relay/src/cdp-executor.ts`

A new class that implements `ExecutorLike` (already defined in `server.ts` line 97):

```typescript
export interface ExecutorLike {
  execute(code: string, timeout: number): Promise<{ text: string; images: Array<{ data: string; mimeType: string }>; isError: boolean }>
  reset(): Promise<{ page: { url(): string }; context: { pages(): any[] } }>
  getSessionMetadata(): { extensionId: string | null; browser: string | null; profile: { email: string; id: string } | null }
}
```

The `CDPExecutor` wraps `sendToExtension()` to provide:
- `sendCDP(method, params)` — sends a CDP command to the Extension for this session's tab
- `evaluate(expression)` — `Runtime.evaluate` wrapper
- `navigate(url)` — `Page.navigate` + wait for load
- `screenshot()` — `Page.captureScreenshot`
- `execute(code, timeout)` — evaluates JS code in the browser, formats result

**Key difference from PlaywrightExecutor:** No Playwright. No `chromium.connectOverCDP()`. Just direct CDP through the existing Extension WebSocket.

### 1.2 Create `packages/relay/src/cdp-executor-manager.ts`

Implements `ExecutorManagerLike`. Manages multiple `CDPExecutor` instances keyed by session ID. Replaces the injected `executorManagerFactory` pattern — the Relay can now create executors natively.

### 1.3 Wire into Relay Server

Replace the lazy `executorManagerFactory` pattern in `server.ts`:

```typescript
// Before: external factory injected (for PlaywrightExecutor)
let executorManager: ExecutorManagerLike | null = null
const getExecutorManager = async () => {
  if (!executorManager) {
    executorManager = await executorManagerFactory({ cdpConfig, logger })
  }
  return executorManager
}

// After: built-in CDPExecutorManager (no factory needed)
const executorManager = new CDPExecutorManager({ sendToExtension, logger })
```

### 1.4 Verify `/api/execute`, `/api/reset`, `/api/session/*` endpoints still work

The HTTP API shape doesn't change. MCP and CLI use `RelayApiClient` which talks to these endpoints. Only the internal executor implementation changes.

**Files changed:**
- New: `packages/relay/src/cdp-executor.ts`
- New: `packages/relay/src/cdp-executor-manager.ts`
- Modified: `packages/relay/src/server.ts` (remove `executorManagerFactory`, use built-in executor)
- Modified: `packages/relay/src/start.ts` (remove `executorManagerFactory` param)
- Modified: `packages/relay/src/index.ts` (export new types)

---

## Phase 2: Migrate Core Features to CDP

**Goal:** Reimplement the key features that currently depend on Playwright types.

### 2.1 Snapshot (Accessibility Tree)

- Current: `packages/core/src/aria-snapshot.ts` — uses `Page`, `Locator`, `Frame` from Playwright, but internally already uses CDP via `ICDPSession`
- Refactor: Accept `ICDPSession` as the only input (remove Playwright type dependencies)
- CDP method: `Accessibility.getFullAXTree` or `Accessibility.getPartialAXTree`
- **This is the most important feature** — the snapshot + ref pattern is the primary way AI agents understand pages
- Move refactored snapshot logic to `packages/relay/src/snapshot.ts`

### 2.2 Screenshot

- Current: Uses Playwright's `page.screenshot()` and custom accessibility label overlay
- Refactor: `Page.captureScreenshot` via CDP (trivial)
- Annotated screenshot (with accessibility labels): compose snapshot refs onto screenshot image
- Move to `packages/relay/src/screenshot.ts`

### 2.3 JavaScript Evaluation

- Current: `PlaywrightExecutor.execute()` uses `vm.runInContext()` with Playwright's `page`, `context` in scope
- Refactor: Two modes:
  - **Simple evaluate**: `Runtime.evaluate` — run JS directly in the browser (for `execute` MCP tool)
  - **Complex evaluate**: `Runtime.evaluate` with helper utilities injected (for batch operations)
- No more Node.js `vm` sandbox — code runs in the browser directly
- This is simpler and more natural: the AI writes browser JS, not Playwright JS

### 2.4 Navigation

- Current: `page.goto(url)`
- Refactor: `Page.navigate` + `Page.loadEventFired` event
- Add `Page.enable` for navigation events

### 2.5 Input (Click, Fill, Type)

- Current: `page.locator().click()`, `page.fill()` (Playwright auto-wait)
- Refactor:
  - `click(ref)`: resolve ref → get element position via `Runtime.evaluate` → `Input.dispatchMouseEvent`
  - `fill(ref, value)`: focus element → `Input.insertText`
  - `type(ref, text)`: focus → dispatch key events
- **No auto-wait** — AI agents snapshot, act, verify themselves (as agent-browser proved)

**Files changed/created:**
- New: `packages/relay/src/snapshot.ts` (from core/aria-snapshot.ts, CDP-only)
- New: `packages/relay/src/screenshot.ts`
- New: `packages/relay/src/commands.ts` (navigate, click, fill, type, scroll, etc.)

---

## Phase 3: Add High-Level MCP Tools

**Goal:** Expose browser commands as individual MCP tools (like agent-browser's CLI commands).

### 3.1 Update MCP Server (`packages/mcp/src/server.ts`)

Current tools:
- `execute` — run arbitrary Playwright code
- `reset` — reconnect
- `snapshot` — accessibility snapshot
- `screenshot` — screenshot with labels

New tools (keep existing + add):

```
navigate(url)                    → Go to URL
click(ref_or_selector)           → Click element
fill(ref_or_selector, value)     → Fill input
type(text)                       → Type with keyboard (no selector, current focus)
press(key)                       → Press key (Enter, Tab, etc.)
select(ref_or_selector, value)   → Select dropdown
scroll(direction, amount?)       → Scroll page
hover(ref_or_selector)           → Hover element
snapshot(options?)               → Accessibility tree with refs
screenshot(options?)             → Screenshot (with optional annotations)
evaluate(code)                   → Run JS in browser (via Runtime.evaluate)
get_text(ref_or_selector)        → Get text content
get_url()                        → Get current URL
get_title()                      → Get page title
back()                           → Navigate back
forward()                        → Navigate forward
reload()                         → Reload page
tab_list()                       → List open tabs
tab_switch(index)                → Switch tab
tab_new(url?)                    → New tab
tab_close(index?)                → Close tab
wait(options)                    → Wait for element/time/condition
reset()                          → Reset connection
```

### 3.2 Ref Resolution

Adopt agent-browser's `@ref` pattern:
- `snapshot()` returns tree with `[ref=e1]`, `[ref=e2]`, etc.
- `click("@e2")` resolves the ref to the actual element
- Refs are cached per-session between snapshot calls
- Also support CSS selectors as fallback: `click("#submit")`

### 3.3 Update MCP Prompts

Update the tool descriptions and system prompt to teach AI agents:
1. Always `snapshot()` first to understand the page
2. Use refs (`@e1`, `@e2`) from snapshot to interact
3. Use `evaluate(code)` for complex operations
4. Re-snapshot after actions to verify

### 3.4 `evaluate` replaces both old `execute` and `evaluate`

There's no need for separate `execute` and `evaluate` tools — they both use `Runtime.evaluate` under the hood. One `evaluate` tool handles everything:

```javascript
// Simple expression
evaluate("document.title")

// Complex batch operation
evaluate(`
  const rows = document.querySelectorAll('tr.item')
  const data = []
  for (const row of rows) {
    data.push({ name: row.querySelector('.name').textContent })
  }
  JSON.stringify(data)
`)

// Async operations
evaluate("await fetch('/api/data').then(r => r.json())")
```

AI writes browser JS instead of Playwright code — simpler and more natural.

**Files changed:**
- Modified: `packages/mcp/src/server.ts` (add new tools, update existing)
- New: `packages/relay/src/ref-resolver.ts` (snapshot ref → element resolution)

---

## Phase 4: Remove Playwright

**Goal:** Delete all Playwright dependencies and code.

### 4.1 Delete PlaywrightExecutor and related files

Files to delete from `packages/core/src/`:
- `executor.ts` (1307 lines) — replaced by `packages/relay/src/cdp-executor.ts`
- `cdp-session.ts` (360 lines) — no longer needed (we use Extension directly)
- `playwright-compat.ts` (88 lines) — private API hacks, no longer needed

### 4.2 Refactor remaining core files

These files import Playwright types but may still be useful:
- `aria-snapshot.ts` → migrated to `packages/relay/src/snapshot.ts` in Phase 2
- `clean-html.ts` → rewrite to use `Runtime.evaluate` (run in browser)
- `page-markdown.ts` → rewrite to use `Runtime.evaluate`
- `styles.ts` → rewrite to use CDP `CSS.getComputedStyleForNode`
- `debugger.ts` → already uses `ICDPSession`, just remove Playwright type imports
- `editor.ts` → already uses `ICDPSession`, just remove Playwright type imports
- `react-source.ts` → rewrite to use `Runtime.evaluate`
- `cursor-overlay.ts` → evaluate: run overlay JS in browser
- `screen-recording.ts` → uses Extension recording API (already CDP-based)
- `wait-for-page-load.ts` → replace with CDP `Page.loadEventFired`
- `recording-cursor-overlay.ts` → depends on Page type, refactor

### 4.3 Remove Playwright from package.json

```bash
# packages/core/package.json
pnpm remove playwright-core --filter @runbrowser/core

# packages/relay/package.json  
pnpm remove playwright-core --filter @runbrowser/relay

# packages/e2e/package.json
pnpm remove playwright-core --filter @runbrowser/e2e
```

### 4.4 Remove `executorManagerFactory` pattern from Relay

The Relay Server no longer needs an external factory. `CDPExecutorManager` is built-in.

**Files deleted:**
- `packages/core/src/executor.ts`
- `packages/core/src/cdp-session.ts`
- `packages/core/src/playwright-compat.ts`

**Files refactored:**
- All files listed in 4.2
- `packages/relay/src/server.ts` (remove `ExecutorManagerFactory` type)
- `packages/core/package.json` (remove `playwright-core`)

---

## Phase 5: Update CLI

**Goal:** CLI uses new high-level commands.

### 5.1 Add direct command support to CLI

```bash
# Current
runbrowser -s 1 -e "await page.goto('https://example.com')"

# New (still works)
runbrowser -s 1 -e "document.title"

# New high-level commands
runbrowser -s 1 navigate https://example.com
runbrowser -s 1 snapshot
runbrowser -s 1 click @e2
runbrowser -s 1 fill @e3 "hello"
runbrowser -s 1 screenshot
```

### 5.2 Update RelayApiClient

Add methods for new commands:
- `client.navigate(sessionId, url)`
- `client.click(sessionId, ref)`
- `client.fill(sessionId, ref, value)`
- `client.snapshot(sessionId, options)`
- `client.screenshot(sessionId, options)`

---

## Phase 6: Update Tests

### 6.1 Update E2E tests (`packages/e2e/`)

- Tests currently spawn MCP server and send Playwright code
- Update to use new MCP tools (navigate, click, snapshot, etc.)
- Add tests for ref resolution
- Add tests for direct CDP execution

### 6.2 Update unit tests (`packages/core/`, `packages/relay/`)

- Add unit tests for `CDPExecutor`
- Add unit tests for snapshot ref generation/resolution
- Add unit tests for CDP command translation

---

## Execution Order & Dependencies

```
Phase 0 (Preparation)           ← Start here
  ↓
Phase 1 (CDPExecutor)           ← Core change, everything depends on this
  ↓
Phase 2 (Migrate features)      ← Can be done incrementally, feature by feature
  ↓
Phase 3 (MCP tools)             ← Depends on Phase 1 + 2
  ↓
Phase 4 (Remove Playwright)     ← Only after Phase 1-3 are stable
  ↓
Phase 5 (CLI updates)           ← Can start after Phase 3
  ↓
Phase 6 (Tests)                 ← Ongoing throughout all phases
```

## Risk Mitigation

1. **Keep `execute` tool working throughout** — AI agents that write Playwright code will need to adapt, but `evaluate(code)` running browser JS is a simpler API
2. **Phase 1 can coexist with Playwright** — implement CDPExecutor alongside PlaywrightExecutor, switch with a flag
3. **Auto-wait is the biggest risk** — monitor AI agent success rates after removing Playwright's auto-wait. If needed, add simple retry logic in click/fill commands
4. **Test with real AI agents** (Claude, Cursor) at each phase to catch regressions

## Files Summary

### New files
| File | Phase | Description |
|------|-------|-------------|
| `packages/relay/src/cdp-executor.ts` | 1 | CDP-based executor (replaces PlaywrightExecutor) |
| `packages/relay/src/cdp-executor-manager.ts` | 1 | Session manager for CDPExecutor instances |
| `packages/relay/src/commands.ts` | 2 | High-level commands (click, fill, navigate, etc.) |
| `packages/relay/src/snapshot.ts` | 2 | Accessibility snapshot with refs (CDP-only) |
| `packages/relay/src/screenshot.ts` | 2 | Screenshot with optional annotations |
| `packages/relay/src/ref-resolver.ts` | 3 | Resolve @ref to element for interactions |

### Deleted files (Phase 4)
| File | Lines | Reason |
|------|-------|--------|
| `packages/core/src/executor.ts` | 1307 | Replaced by cdp-executor.ts |
| `packages/core/src/cdp-session.ts` | 360 | No longer needed |
| `packages/core/src/playwright-compat.ts` | 88 | Private API hacks |

### Modified files
| File | Phase | Changes |
|------|-------|---------|
| `packages/relay/src/server.ts` | 1 | Replace executorManagerFactory with built-in CDPExecutorManager |
| `packages/relay/src/start.ts` | 1 | Remove executorManagerFactory param |
| `packages/relay/src/index.ts` | 1 | Export new types |
| `packages/mcp/src/server.ts` | 3 | Add high-level MCP tools |
| `packages/cli/src/cli.ts` | 5 | Add high-level CLI commands |
| `packages/relay/src/api-client.ts` | 5 | Add methods for new commands |
| `packages/core/package.json` | 4 | Remove playwright-core |

## Estimated Effort

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 0: Preparation | 1-2 days | Low |
| Phase 1: CDPExecutor | 3-5 days | Medium |
| Phase 2: Migrate features | 5-7 days | Medium |
| Phase 3: MCP tools | 3-4 days | Low |
| Phase 4: Remove Playwright | 2-3 days | Medium |
| Phase 5: CLI updates | 1-2 days | Low |
| Phase 6: Tests | 3-5 days | Low |
| **Total** | **~3-4 weeks** | |
