# Editor API Reference

The Editor class provides a Claude Code-like interface for viewing and editing web page scripts at runtime.

## Quick Start

```js
const cdp = await getCDPSession({ page: state.page })
const editor = createEditor({ cdp })
await editor.enable()

// List available scripts
const scripts = await editor.list({ pattern: /app/ })

// Read a script
const { content } = await editor.read({ url: 'https://example.com/app.js' })

// Edit a script (exact string replacement)
await editor.edit({
  url: 'https://example.com/app.js',
  oldString: 'console.log("old")',
  newString: 'console.log("new")',
})

// Search across all scripts
const matches = await editor.grep({ regex: /console\.log/ })
```

## Methods

### `editor.list({ pattern? })`

Lists available script and stylesheet URLs. Automatically enables the editor if not already enabled.

- `pattern` - Optional regex to filter URLs

### `editor.read({ url, offset?, limit? })`

Reads a script or stylesheet's source code by URL. Returns line-numbered content.

- `url` - Script or stylesheet URL
- `offset` - Line number to start from (0-based, default 0)
- `limit` - Number of lines to return (default 2000)

### `editor.edit({ url, oldString, newString, dryRun? })`

Edits a script or stylesheet by replacing oldString with newString. Edits are in-memory only and persist until page reload.

- `url` - Script or stylesheet URL
- `oldString` - Exact string to find and replace
- `newString` - Replacement string
- `dryRun` - If true, validate without applying (default false)

### `editor.grep({ regex, pattern? })`

Searches for a regex across all scripts and stylesheets.

- `regex` - Regular expression to search for
- `pattern` - Optional regex to filter which URLs to search

### `editor.write({ url, content, dryRun? })`

Writes entire content to a script or stylesheet. Use with caution — prefer `edit()` for targeted changes.

## Examples

```js
// List and read CSS stylesheets
const stylesheets = await editor.list({ pattern: /\.css/ })
const { content } = await editor.read({ url: stylesheets[0] })

// Edit CSS
await editor.edit({
  url: 'https://example.com/styles.css',
  oldString: 'color: red',
  newString: 'color: blue',
})

// Search for TODO comments
const todos = await editor.grep({ regex: /TODO|FIXME/i, pattern: /\.js/ })
```
