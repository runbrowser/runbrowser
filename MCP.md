# MCP Setup

> **Note:** CLI is the recommended way to use RunBrowser. See [README.md](./README.md) for CLI usage.

Add to your MCP client settings:

```json
{
  "mcpServers": {
    "runbrowser": {
      "command": "npx",
      "args": ["-y", "@jiweiyuan/runbrowser-mcp@latest"]
    }
  }
}
```

## Using the MCP

1. Enable the extension on at least one tab (click icon → turns green)
2. MCP automatically starts relay server and connects to enabled tabs
3. Use the tools to control the browser:

The MCP exposes:

- `execute` tool — run Playwright code snippets
- `reset` tool — reconnect if connection issues occur
- `snapshot` tool — take accessibility snapshot of the page
- `screenshot` tool — take screenshot with accessibility labels

## Environment Variables

### `RUNBROWSER_AUTO_ENABLE`

Auto-create a tab when Playwright connects (no manual extension click needed).

> **Note:** CLI enables this by default. This is only needed for MCP server usage.

```json
{
  "mcpServers": {
    "runbrowser": {
      "command": "npx",
      "args": ["-y", "@jiweiyuan/runbrowser-mcp@latest"],
      "env": {
        "RUNBROWSER_AUTO_ENABLE": "1"
      }
    }
  }
}
```

The auto-created tab starts at `about:blank`. Navigate it to any URL.

## Remote Agents (Devcontainers, VMs, SSH)

Run agents in isolated environments while controlling Chrome on your host.

**On host (where Chrome runs):**

```bash
npx -y @jiweiyuan/runbrowser serve --token <secret>
```

**In container/VM (where agent runs):**

```json
{
  "mcpServers": {
    "runbrowser": {
      "command": "npx",
      "args": ["-y", "@jiweiyuan/runbrowser-mcp@latest", "--host", "host.docker.internal", "--token", "<secret>"]
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
      "args": ["-y", "@jiweiyuan/runbrowser-mcp@latest"],
      "env": {
        "RUNBROWSER_HOST": "host.docker.internal",
        "RUNBROWSER_TOKEN": "<secret>"
      }
    }
  }
}
```

Use `host.docker.internal` for devcontainers, or your host's IP for VMs/SSH.
