# @termio/browser-mcp

Standalone MCP (Model Context Protocol) server for [RunBrowser](https://github.com/runbrowser/runbrowser) — control your running Chrome browser via Playwright with your logins, extensions, and cookies already there.

## Setup

### Prerequisites

1. [**Install the RunBrowser Extension**](https://chromewebstore.google.com/detail/@termio/browser-mcp/jfeammnjpkecdekppnclgkkffahnhfhe) from Chrome Web Store
2. Click the extension icon on a tab → turns green when connected

### MCP Client Configuration

Add to your MCP client settings (e.g., Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "runbrowser": {
      "command": "npx",
      "args": ["-y", "@termio/browser-mcp@latest"]
    }
  }
}
```

## MCP Tools

The server exposes the following tools:

| Tool | Description |
|------|-------------|
| **`execute`** | Run Playwright code snippets with `{page, state, context}` in scope |
| **`reset`** | Recreate CDP connection and reset browser/page/context |
| **`snapshot`** | Take accessibility snapshot of the current page (fast, text-based) |
| **`screenshot`** | Take screenshot with Vimium-style accessibility labels overlaid |

## MCP Resources

| Resource | Description |
|----------|-------------|
| `debugger-api` | Debugger API documentation |
| `editor-api` | Live editor API documentation |
| `styles-api` | CSS styles inspection API documentation |

## Environment Variables

### `TERMIO_BROWSER_AUTO_ENABLE`

Auto-create a tab when Playwright connects (no manual extension click needed).

```json
{
  "mcpServers": {
    "runbrowser": {
      "command": "npx",
      "args": ["-y", "@termio/browser-mcp@latest"],
      "env": {
        "TERMIO_BROWSER_AUTO_ENABLE": "1"
      }
    }
  }
}
```

## Remote Agents (Devcontainers, VMs, SSH)

Run agents in isolated environments while controlling Chrome on your host.

**On host (where Chrome runs):**

```bash
npx -y @termio/browser serve --token <secret>
```

**In container/VM (where agent runs):**

```json
{
  "mcpServers": {
    "runbrowser": {
      "command": "npx",
      "args": ["-y", "@termio/browser-mcp@latest", "--host", "host.docker.internal", "--token", "<secret>"]
    }
  }
}
```

Or with environment variables:

```json
{
  "mcpServers": {
    "runbrowser": {
      "command": "npx",
      "args": ["-y", "@termio/browser-mcp@latest"],
      "env": {
        "TERMIO_BROWSER_HOST": "host.docker.internal",
        "TERMIO_BROWSER_TOKEN": "<secret>"
      }
    }
  }
}
```

Use `host.docker.internal` for devcontainers, or your host's IP for VMs/SSH.

## Programmatic Usage

```ts
import { startMcp } from '@termio/browser-mcp'

// Start MCP server (connects to stdio transport)
await startMcp()

// With remote relay server
await startMcp({
  host: 'host.docker.internal',
  token: 'your-secret-token',
})
```

## License

MIT
