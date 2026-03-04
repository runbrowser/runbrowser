# Refactoring Prompt

Copy the prompt for the phase you want to execute. Each prompt is self-contained — paste it into a new Claude Code session.

---

## Phase 0: Preparation

```
I'm refactoring RunBrowser to remove Playwright and use direct CDP through the existing Extension WebSocket.

Read the refactoring plan: /Users/yuanjiwei/Documents/GitHub/runbrowser/docs/refactoring-plan.md

Then do Phase 0 — Preparation:

1. Read `packages/extension/src/background.ts` and document every CDP command the Extension supports. Focus on the `handleCommand` function and `chrome.debugger.sendCommand` calls. Write the output to `docs/cdp-capabilities.md`.

2. Read `packages/relay/src/server.ts` and document how `sendToExtension()` works — its signature, how it routes CDP commands to the Extension, how it handles responses/errors, and how sessions map to tabs. Add this to `docs/cdp-capabilities.md`.

3. Read how the current `/api/execute` endpoint works end-to-end: HTTP request → ExecutorManager → PlaywrightExecutor → Playwright → Relay CDP WebSocket → Extension → chrome.debugger. Document this flow in `docs/cdp-capabilities.md` to show exactly what we're replacing.

4. Identify every place `sendToExtension` is called with `forwardCDPCommand` in the relay server — these are the CDP commands already being sent. List them.

Don't change any code yet. Only produce documentation.
```

---

## Phase 1: Build CDPExecutor

```
I'm refactoring RunBrowser to remove Playwright and use direct CDP.

Read these files first:
- /Users/yuanjiwei/Documents/GitHub/runbrowser/docs/refactoring-plan.md (full plan)
- /Users/yuanjiwei/Documents/GitHub/runbrowser/docs/cdp-capabilities.md (from Phase 0)
- packages/relay/src/server.ts (relay server — focus on sendToExtension, ExecutorManagerLike, ExecutorLike interfaces, and /api/* endpoints)
- packages/relay/src/start.ts (server startup)
- packages/core/src/executor.ts (PlaywrightExecutor we're replacing)

Do Phase 1 — Build CDPExecutor in the Relay package:

1. Create `packages/relay/src/cdp-executor.ts`:
   - Class `CDPExecutor` that implements the `ExecutorLike` interface (already defined in server.ts)
   - Constructor takes: a `sendCDP` function (that wraps sendToExtension for this session's tab), session metadata, logger
   - `execute(code, timeout)`: Use `Runtime.evaluate` with `awaitPromise: true, returnByValue: true` to run JS in the browser. Format the result as `{ text, images, isError }`. Handle errors gracefully.
   - `reset()`: Re-enable `Runtime` and `Page` domains. Return current page URL and page count.
   - `getSessionMetadata()`: Return stored metadata.
   - Keep it simple — no auto-wait, no vm sandbox, no Playwright. Just CDP.

2. Create `packages/relay/src/cdp-executor-manager.ts`:
   - Class `CDPExecutorManager` that implements `ExecutorManagerLike` (already defined in server.ts)
   - Manages CDPExecutor instances keyed by session ID
   - Constructor takes: a function to get `sendCDP` for a given session/extension, logger
   - `getExecutor(options)` / `getSession(id)` / `listSessions()` / `deleteExecutor(id)`

3. Modify `packages/relay/src/server.ts`:
   - Import and use `CDPExecutorManager` directly instead of the lazy `executorManagerFactory` pattern
   - The CDPExecutorManager needs access to `sendToExtension` and session→tab mapping (already in the server)
   - Remove `executorManagerFactory` from the server config interface
   - The `/api/execute`, `/api/reset`, `/api/session/*` endpoints should work unchanged — they use `ExecutorLike` interface

4. Modify `packages/relay/src/start.ts`:
   - Remove `executorManagerFactory` parameter (no longer needed)

5. Modify `packages/relay/src/index.ts`:
   - Export `CDPExecutor` and `CDPExecutorManager`

6. Verify the build passes: `cd packages/relay && pnpm build`

Important constraints:
- Do NOT modify packages/core, packages/mcp, or packages/cli yet
- Do NOT remove Playwright yet — it can coexist for now
- The ExecutorLike interface shape must not change (MCP and CLI depend on it)
- The HTTP API (/api/execute, /api/reset, etc.) must return the same response shape
```

---

## Phase 2: Migrate Core Features to CDP

```
I'm refactoring RunBrowser to remove Playwright and use direct CDP.

Read these files first:
- /Users/yuanjiwei/Documents/GitHub/runbrowser/docs/refactoring-plan.md (Phase 2)
- packages/relay/src/cdp-executor.ts (from Phase 1)
- packages/core/src/aria-snapshot.ts (current snapshot implementation — already uses CDP internally)
- packages/relay/src/server.ts (sendToExtension function)

Do Phase 2 — Migrate core features to CDP. Create these files in packages/relay/src/:

### 2.1 `packages/relay/src/snapshot.ts`
Port the accessibility snapshot from `packages/core/src/aria-snapshot.ts`. Key changes:
- Input is a `sendCDP(method, params)` function, NOT a Playwright Page
- Use `Accessibility.getFullAXTree` via CDP
- Keep the ref generation logic (`[ref=e1]`, `[ref=e2]`)
- Keep the tree formatting, interactive-only filtering, search/context functionality
- Return `{ snapshot: string, refs: Map<string, RefInfo> }` where RefInfo has the backendNodeId for later interaction
- Study agent-browser's snapshot.ts at `/tmp/agent-browser/src/snapshot.ts` for reference on CDP-only snapshot approach

### 2.2 `packages/relay/src/screenshot.ts`
- `captureScreenshot(sendCDP)`: Use `Page.captureScreenshot` → return base64 PNG
- `captureAnnotatedScreenshot(sendCDP)`: Take screenshot + snapshot, overlay numbered labels on interactive elements, return both image and snapshot text
- For image annotation, use sharp (already a dependency) or canvas to draw labels

### 2.3 `packages/relay/src/commands.ts`
High-level browser commands, each taking a `sendCDP` function:

- `navigate(sendCDP, url)`: `Page.navigate` + wait for `Page.loadEventFired`
- `click(sendCDP, ref, refMap)`: Resolve ref → get bounding box via `Runtime.evaluate` using backendNodeId → `Input.dispatchMouseEvent` (mousePressed + mouseReleased)
- `fill(sendCDP, ref, value, refMap)`: Resolve ref → focus element → clear → `Input.insertText`
- `type(sendCDP, text)`: `Input.dispatchKeyEvent` for each character (current focus)
- `press(sendCDP, key)`: `Input.dispatchKeyEvent` for special keys (Enter, Tab, etc.)
- `scroll(sendCDP, direction, amount)`: `Input.dispatchMouseEvent` with wheel type
- `hover(sendCDP, ref, refMap)`: Resolve ref → `Input.dispatchMouseEvent` (mouseMoved)
- `getText(sendCDP, ref, refMap)`: Resolve ref → `Runtime.evaluate` to get textContent
- `getUrl(sendCDP)`: `Runtime.evaluate` → `window.location.href`
- `getTitle(sendCDP)`: `Runtime.evaluate` → `document.title`
- `goBack(sendCDP)`: `Page.navigateToHistoryEntry` or `Runtime.evaluate` → `history.back()`
- `goForward(sendCDP)`: Same pattern
- `reload(sendCDP)`: `Page.reload`

### 2.4 `packages/relay/src/ref-resolver.ts`
- Store refs from last snapshot per session
- `resolveRef(ref, refMap)`: Given "@e2", return the backendNodeId or element info needed for interaction
- `getElementBox(sendCDP, backendNodeId)`: Get bounding box for clicking using `DOM.getBoxModel`

### 2.5 Update `packages/relay/src/cdp-executor.ts`
Wire the snapshot, screenshot, and commands into the executor so `/api/execute` can access them. Add new HTTP endpoints to server.ts:
- `POST /api/navigate` → `{ sessionId, url }`
- `POST /api/click` → `{ sessionId, ref }`
- `POST /api/fill` → `{ sessionId, ref, value }`
- `POST /api/snapshot` → `{ sessionId, options? }`
- `POST /api/screenshot` → `{ sessionId, options? }`
- `POST /api/evaluate` → `{ sessionId, code }`
- Keep `POST /api/execute` working (now uses Runtime.evaluate instead of Playwright vm)

Build and verify: `cd packages/relay && pnpm build`
```

---

## Phase 3: Add High-Level MCP Tools

```
I'm refactoring RunBrowser to remove Playwright and use direct CDP.

Read these files first:
- /Users/yuanjiwei/Documents/GitHub/runbrowser/docs/refactoring-plan.md (Phase 3)
- packages/relay/src/commands.ts (from Phase 2)
- packages/relay/src/snapshot.ts (from Phase 2)
- packages/relay/src/api-client.ts (HTTP client used by MCP)
- packages/mcp/src/server.ts (current MCP server)
- /tmp/agent-browser/README.md (reference for tool design — study the snapshot + ref workflow)

Do Phase 3 — Add high-level MCP tools:

### 3.1 Update `packages/relay/src/api-client.ts`
Add methods for the new HTTP endpoints:
- `navigate(sessionId, url)`
- `click(sessionId, ref)`
- `fill(sessionId, ref, value)`
- `type(sessionId, text)`
- `press(sessionId, key)`
- `scroll(sessionId, direction, amount?)`
- `hover(sessionId, ref)`
- `snapshot(sessionId, options?)`
- `screenshot(sessionId, options?)`
- `evaluate(sessionId, code)`
- `getText(sessionId, ref)`
- `getUrl(sessionId)`
- `getTitle(sessionId)`
- `goBack(sessionId)`
- `goForward(sessionId)`
- `reload(sessionId)`

### 3.2 Rewrite `packages/mcp/src/server.ts`
Replace current tools with high-level tools. Each tool is a direct MCP tool (not code execution):

```typescript
server.tool('navigate', 'Navigate to a URL', { url: z.string() }, async ({ url }) => {
  const sid = await ensureSession()
  const result = await client.navigate(sid, url)
  return { content: [{ type: 'text', text: `Navigated to ${result.url} - ${result.title}` }] }
})

server.tool('click', 'Click an element by ref (@e1) or CSS selector', { ref: z.string() }, async ({ ref }) => {
  const sid = await ensureSession()
  await client.click(sid, ref)
  return { content: [{ type: 'text', text: `Clicked ${ref}` }] }
})

server.tool('fill', 'Fill an input by ref or selector', { ref: z.string(), value: z.string() }, ...)
server.tool('type', 'Type text with keyboard (current focus)', { text: z.string() }, ...)
server.tool('press', 'Press a key (Enter, Tab, Escape, etc.)', { key: z.string() }, ...)
server.tool('snapshot', 'Get accessibility tree with refs for element interaction', { ... }, ...)
server.tool('screenshot', 'Take a screenshot', { annotate: z.boolean().optional() }, ...)
server.tool('evaluate', 'Run JavaScript in the browser', { code: z.string() }, ...)
server.tool('get_text', 'Get text content of an element', { ref: z.string() }, ...)
server.tool('get_url', 'Get current page URL', {}, ...)
server.tool('get_title', 'Get page title', {}, ...)
server.tool('back', 'Navigate back', {}, ...)
server.tool('forward', 'Navigate forward', {}, ...)
server.tool('reload', 'Reload page', {}, ...)
server.tool('scroll', 'Scroll the page', { direction: z.enum(['up','down','left','right']), amount: z.number().optional() }, ...)
server.tool('hover', 'Hover over an element', { ref: z.string() }, ...)
server.tool('reset', 'Reset browser connection', {}, ...)
```

### 3.3 Update the MCP prompt/description
The main tool prompt should teach the AI agent:
1. Use `snapshot` first to see the page (returns accessibility tree with [ref=e1] markers)
2. Use refs from snapshot to interact: `click` @e1, `fill` @e3 with value
3. Use `evaluate` for complex JS operations the high-level tools can't do
4. Re-snapshot after actions to verify results
5. Use `screenshot` when visual layout information is needed

### 3.4 Keep resources (debugger-api.md, editor-api.md, styles-api.md)
These can stay for now but mark them as using the old Playwright API. They'll be updated in Phase 4.

Build and verify: `cd packages/mcp && pnpm build`
```

---

## Phase 4: Remove Playwright

```
I'm refactoring RunBrowser to remove Playwright and use direct CDP.

Read these files first:
- /Users/yuanjiwei/Documents/GitHub/runbrowser/docs/refactoring-plan.md (Phase 4)
- packages/relay/src/cdp-executor.ts (new executor, Phase 1)
- packages/relay/src/commands.ts (new commands, Phase 2)
- packages/mcp/src/server.ts (new MCP tools, Phase 3)

Do Phase 4 — Remove Playwright:

### 4.1 Delete PlaywrightExecutor and its dependencies
Delete from `packages/core/src/`:
- `executor.ts` — replaced by relay/cdp-executor.ts
- `cdp-session.ts` — no longer needed (Extension handles CDP)
- `playwright-compat.ts` — private Playwright API hacks

### 4.2 Refactor or delete remaining Playwright-dependent files in packages/core/src/
For each file that imports from 'playwright-core', decide:
- If the functionality is now in packages/relay (snapshot, screenshot, commands): delete the core version
- If it still provides value (debugger.ts, editor.ts): refactor to only use ICDPSession/CDP types from devtools-protocol, not Playwright types
- `aria-snapshot.ts` → delete (replaced by relay/snapshot.ts)
- `clean-html.ts` → if still needed, refactor to take sendCDP instead of Page
- `page-markdown.ts` → if still needed, refactor to use Runtime.evaluate
- `styles.ts` → refactor to use CDP CSS domain directly
- `debugger.ts` → already mostly CDP, remove Playwright type imports
- `editor.ts` → already mostly CDP, remove Playwright type imports
- `react-source.ts` → refactor to use Runtime.evaluate
- `cursor-overlay.ts` → refactor to use Runtime.evaluate to inject JS
- `recording-cursor-overlay.ts` → refactor
- `screen-recording.ts` → uses Extension recording API, refactor types
- `wait-for-page-load.ts` → delete (navigation waiting is now in commands.ts)

### 4.3 Update packages/core/src/index.ts
Remove exports for deleted files. Keep exports for refactored files.

### 4.4 Remove playwright-core dependency
```bash
cd /Users/yuanjiwei/Documents/GitHub/runbrowser
pnpm remove playwright-core --filter @agmod/runbrowser-core
pnpm remove playwright-core --filter @agmod/runbrowser-relay
pnpm remove playwright-core --filter @runbrowser/e2e
```

### 4.5 Remove executorManagerFactory from relay server
In `packages/relay/src/server.ts`, clean up:
- Remove `ExecutorManagerFactory` type export
- Remove `executorManagerFactory` from server config
- The CDPExecutorManager is the only executor now

### 4.6 Verify everything builds
```bash
cd /Users/yuanjiwei/Documents/GitHub/runbrowser
pnpm -r build
```

### 4.7 Commit in logical order
Split into ~5 commits: delete executor files, refactor core files, remove deps, clean up server, verify build.
```

---

## Phase 5: Update CLI

```
I'm refactoring RunBrowser to remove Playwright and use direct CDP.

Read these files first:
- /Users/yuanjiwei/Documents/GitHub/runbrowser/docs/refactoring-plan.md (Phase 5)
- packages/cli/src/cli.ts (current CLI)
- packages/relay/src/api-client.ts (updated with new methods from Phase 3)

Do Phase 5 — Update CLI with high-level commands:

### 5.1 Add subcommands to `packages/cli/src/cli.ts`

Using the `cac` library (already in use), add commands:

```bash
runbrowser -s <session> navigate <url>
runbrowser -s <session> snapshot [-i] [--compact]
runbrowser -s <session> click <ref>
runbrowser -s <session> fill <ref> <value>
runbrowser -s <session> screenshot [path]
runbrowser -s <session> evaluate <code>
runbrowser -s <session> get text <ref>
runbrowser -s <session> get url
runbrowser -s <session> get title
```

Keep the existing `-e` flag working — it now maps to `evaluate`.

### 5.2 Update `--help` output
Make sure `runbrowser --help` shows all available commands clearly.

### 5.3 Build and verify
```bash
cd packages/cli && pnpm build
```
```

---

## Phase 6: Update Tests

```
I'm refactoring RunBrowser to remove Playwright and use direct CDP.

Read these files first:
- /Users/yuanjiwei/Documents/GitHub/runbrowser/docs/refactoring-plan.md (Phase 6)
- packages/e2e/src/ (existing e2e tests)
- packages/relay/src/cdp-executor.ts
- packages/relay/src/commands.ts
- packages/relay/src/snapshot.ts
- packages/mcp/src/server.ts (new MCP tools)

Do Phase 6 — Update tests:

### 6.1 Update E2E tests in `packages/e2e/`
The MCP client tests currently send Playwright code via the `execute` tool. Update them:
- `relay-core.test.ts` → test new MCP tools (navigate, click, fill, snapshot, screenshot, evaluate)
- `snapshot-tools.test.ts` → test snapshot with refs, then click/fill using refs
- `relay-session.test.ts` → test session management still works
- `relay-navigation.test.ts` → test navigate, back, forward, reload via new tools
- `extension-connection.test.ts` → test extension connection still works

### 6.2 Add unit tests for new relay modules
- `packages/relay/src/cdp-executor.test.ts` — mock sendCDP, test execute/reset
- `packages/relay/src/commands.test.ts` — mock sendCDP, test navigate/click/fill/etc.
- `packages/relay/src/snapshot.test.ts` — mock CDP accessibility tree response, test ref generation
- `packages/relay/src/ref-resolver.test.ts` — test ref resolution

### 6.3 Remove obsolete tests
Delete tests that reference Playwright-specific APIs (locators, page objects, etc.) that no longer exist.

### 6.4 Run all tests
```bash
cd /Users/yuanjiwei/Documents/GitHub/runbrowser
pnpm -r test
```
```
