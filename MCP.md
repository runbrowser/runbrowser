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

The MCP exposes two tools:

- `skill` — show full CLI reference and available commands
- `run` — execute any RunBrowser CLI command

Example commands via `run`:

```
run({ command: "navigate https://example.com" })
run({ command: "snapshot" })
run({ command: "click @e1" })
run({ command: "fill @e3 hello" })
run({ command: "upload @e5 ./photo.png" })
run({ command: "download @e2 -o ./file.pdf" })
run({ command: "screenshot" })
run({ command: "eval document.title" })
```

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
