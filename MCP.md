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

The MCP exposes six tools:

| Tool | Purpose |
|---|---|
| `cdp` | Send any Chrome DevTools Protocol method — this is the page API |
| `eval` | Run JavaScript in the page (shorthand for `Runtime.evaluate`) |
| `tab` | List, open, switch and close tabs |
| `status` | Whether a browser is attached — call this when a browser call fails |
| `skill` | Full reference plus the site commands installed here |
| `command` | Run a site command from runbrowser/commands |

There are no `click` / `snapshot` / `fill` tools. Those are all CDP methods,
and a tool per action is surface area to maintain for no capability gain.

```
cdp({ method: "Page.navigate", params: { url: "https://example.com" } })
cdp({ method: "Accessibility.getFullAXTree" })
cdp({ method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: 420, y: 310, button: "left", clickCount: 1 } })
cdp({ method: "Page.captureScreenshot", params: { format: "png" } })
eval({ code: "document.title" })
tab({ action: "new", url: "https://example.com" })
```

Read the page before acting on it: `Accessibility.getFullAXTree` gives roles,
names and `backendDOMNodeId`s; resolve a node's box with `DOM.getBoxModel` and
click its centre. Prefer that over screenshots — cheaper and searchable.

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
