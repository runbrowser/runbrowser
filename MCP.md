# MCP Setup

> **Note:** CLI is the recommended way to use runbrowser. See [README.md](./README.md) for CLI usage.

Add to your MCP client settings:

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["-y", "runbrowser@latest"]
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

There are no `click` / `snapshot` / `fill` tools. Navigation and screenshots are
single CDP methods; clicking and typing are short CDP sequences. A tool per
action is surface area to maintain for no capability gain.

`cdp` sends commands only — CDP *events* are not delivered, so waiting on loads,
dialogs or downloads means polling for an observable side effect.

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

### `TERMIO_BROWSER_AUTO_ENABLE`

Auto-create a tab when Playwright connects (no manual extension click needed).

> **Note:** CLI enables this by default. This is only needed for MCP server usage.

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["-y", "runbrowser@latest"],
      "env": {
        "TERMIO_BROWSER_AUTO_ENABLE": "1"
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
npx -y runbrowser serve --token <secret>
```

**In container/VM (where agent runs):**

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["-y", "runbrowser@latest", "--host", "host.docker.internal", "--token", "<secret>"]
    }
  }
}
```

Or with environment variables:

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["-y", "runbrowser@latest"],
      "env": {
        "TERMIO_BROWSER_HOST": "host.docker.internal",
        "TERMIO_BROWSER_TOKEN": "<secret>"
      }
    }
  }
}
```

Use `host.docker.internal` for devcontainers, or your host's IP for VMs/SSH.
