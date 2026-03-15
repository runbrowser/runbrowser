# Debugger API Reference

The Debugger class provides JavaScript debugging via Chrome DevTools Protocol.

## Quick Start

```js
const cdp = await getCDPSession({ page: state.page })
const dbg = createDebugger({ cdp })
await dbg.enable()

// List scripts and set a breakpoint
const scripts = await dbg.listScripts({ search: 'app' })
await dbg.setBreakpoint({ file: scripts[0].url, line: 42 })

// When paused, inspect state
const vars = await dbg.inspectLocalVariables()
const loc = await dbg.getLocation()
await dbg.resume()
```

## Methods

### `dbg.enable()`

Enables the debugger and runtime domains. Called automatically by other methods.

### `dbg.setBreakpoint({ file, line, condition? })`

Sets a breakpoint at a specified URL and line number. Returns the breakpoint ID.

- `file` - Script URL (e.g. `https://example.com/app.js`)
- `line` - Line number (1-based)
- `condition` - Optional JS expression; only pause when it evaluates to true

### `dbg.deleteBreakpoint({ breakpointId })`

Removes a breakpoint by its ID.

### `dbg.listBreakpoints()`

Returns all active breakpoints set by this debugger instance.

### `dbg.inspectLocalVariables()`

Inspects local variables in the current call frame. Must be paused at a breakpoint.

### `dbg.inspectGlobalVariables()`

Returns global lexical scope variable names.

### `dbg.evaluate({ expression })`

Evaluates a JavaScript expression. When paused, evaluates in the current stack frame scope.

### `dbg.getLocation()`

Gets the current execution location when paused. Includes call stack and source context.

### `dbg.stepOver()` / `dbg.stepInto()` / `dbg.stepOut()` / `dbg.resume()`

Stepping controls for navigating through code execution.

### `dbg.isPaused()`

Returns whether the debugger is currently paused.

### `dbg.setPauseOnExceptions({ state })`

Configures exception pausing: `'none'`, `'uncaught'`, or `'all'`.

### `dbg.listScripts({ search? })`

Lists available scripts. Use `search` to filter by URL (case-insensitive).

### `dbg.setBlackboxPatterns({ patterns })`

Sets regex patterns for scripts to skip when stepping (e.g., `['node_modules']`).

## Examples

```js
// Conditional breakpoint
await dbg.setBreakpoint({
  file: 'https://example.com/app.js',
  line: 42,
  condition: 'userId === 123',
})

// Step through code when paused
if (dbg.isPaused()) {
  const loc = await dbg.getLocation()
  console.log(loc.sourceContext)
  await dbg.stepOver()
}

// Skip framework code
await dbg.setBlackboxPatterns({
  patterns: ['node_modules/react', 'node_modules/react-dom'],
})
```
