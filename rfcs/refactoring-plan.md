# RFC: Drop Playwright, Use Direct CDP

> Status: **Completed** (2026-03-15)

## Summary

Removed `playwright-core` dependency. All browser commands now execute directly through the Relay Server → Extension → `chrome.debugger` (CDP) chain. The refactoring is fully complete.

## Before → After

### Before (Playwright)

```
MCP/CLI
  → HTTP → Relay Server
    → PlaywrightExecutor
      → chromium.connectOverCDP()
        → Relay Server CDP WebSocket endpoint (circular!)
          → Extension WebSocket
            → chrome.debugger.sendCommand
              → Chrome Tab
```

**Problem:** Playwright connected BACK to the Relay Server, which then forwarded to the Extension. Circular connection, unnecessary runtime layer.

### After (Direct CDP)

```
MCP/CLI
  → HTTP → Relay Server
    → CDPExecutor
      → sendToExtension()
        → Extension WebSocket
          → chrome.debugger.sendCommand
            → Chrome Tab
```

**Result:** Simpler, faster, no circular connection. ~800 lines of executor code replaced ~1700 lines of Playwright integration.

## What Was Implemented

### Phase 1: CDPExecutor ✅

- `packages/server/src/cdp-executor.ts` — Replaces `PlaywrightExecutor`
- `packages/server/src/cdp-executor-manager.ts` — Session management
- Built-in executor in relay server (no external factory pattern)

### Phase 2: Core Features via CDP ✅

- `packages/server/src/snapshot.ts` — Accessibility tree via `Accessibility.getFullAXTree`
- `packages/server/src/screenshot.ts` — `Page.captureScreenshot`
- `packages/server/src/commands.ts` — High-level browser commands:
  - Navigation: `navigate`, `goBack`, `goForward`, `reload`
  - Interaction: `click`, `fill`, `type`, `press`, `scroll`, `hover`, `selectOption`
  - Query: `getUrl`, `getTitle`, `getText`, `getHtml`, `getValue`, `getAttribute`
  - State: `isVisible`, `isChecked`, `waitFor`, `viewport`
  - Raw: `rawCDP`

### Phase 3: MCP Tools ✅

MCP server uses two-tool model (`skill` + `run`) instead of individual tools:
- `skill` — Returns full CLI documentation + site command discovery
- `run` — Executes any `runbrowser` command string

The `run` tool internally dispatches to the same `RelayApiClient` methods as the CLI.

### Phase 4: Playwright Removed ✅

- Deleted: `executor.ts`, `cdp-session.ts`, `playwright-compat.ts`
- `playwright-core` removed from all `package.json` files
- Package renamed from `packages/relay` to `packages/server`

### Phase 5: CLI Updated ✅

- Hand-written argument parser (two-phase design)
- All high-level commands mapped to `RelayApiClient` methods
- Auto-session creation

### Phase 6: Tests Updated ✅

- E2E tests use high-level commands instead of Playwright code execution

## Key Design Decisions

### No Auto-Wait

Playwright's auto-wait (wait for element to be visible/stable before clicking) was removed. AI agents use the snapshot → act → re-snapshot loop. Explicit `wait` command is available when needed.

### evaluate vs execute

The old `execute` tool ran arbitrary Playwright code in a Node.js `vm` sandbox. The new `eval` command runs JavaScript directly in the browser via `Runtime.evaluate`. This is simpler, more natural, and eliminates the sandbox complexity.

### Visual Feedback

Added green border flash and element highlighting on interactions — compensates for the loss of Playwright's visual debugging and makes it easy for users to see what the agent is doing.

### Cross-Origin Navigation

Chrome detaches debugging targets during cross-origin navigations. The `waitForReattach` mechanism in `CDPExecutor` polls for target re-attachment instead of creating new tabs, preventing blank tab proliferation.

## File Summary

### New Files (in packages/server/src/)

| File | Description |
|------|-------------|
| `cdp-executor.ts` | Direct CDP executor (replaces PlaywrightExecutor) |
| `cdp-executor-manager.ts` | Session management for CDPExecutor instances |
| `commands.ts` | High-level browser commands via CDP |
| `snapshot.ts` | Accessibility snapshot with @ref generation |
| `screenshot.ts` | Page.captureScreenshot wrapper |
| `api-client.ts` | HTTP client for all relay API endpoints |

### Deleted Files

| File | Lines | Reason |
|------|-------|--------|
| `packages/core/src/executor.ts` | ~1300 | Replaced by cdp-executor.ts |
| `packages/core/src/cdp-session.ts` | ~360 | No longer needed |
| `packages/core/src/playwright-compat.ts` | ~90 | Private API hacks |
