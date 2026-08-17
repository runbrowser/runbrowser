# @termio/browser

Drive your own Chrome over the Chrome DevTools Protocol — the browser you are
already logged into, with your extensions, cookies and sessions intact.

Other browser automation spawns a fresh Chrome: no logins, no extensions, and
a profile that bot detection spots immediately. This connects to the browser
already running on your machine instead, through one extension.

## Install

```sh
npm install -g @termio/browser
```

No runtime prerequisite beyond Node — the compiled binary for your platform is
fetched as an optional dependency.

Then load the extension and click its icon on a tab to attach it.

## Use

```sh
termio-browser status
termio-browser tab new https://example.com
termio-browser eval 'document.title'
termio-browser cdp Accessibility.getFullAXTree | jq '.nodes[] | select(.role.value=="button")'
```

Everything a page can do is a CDP method, so `cdp` reaches the whole protocol
rather than a hand-picked subset of verbs. `eval` and `tab` exist because
reading a value and choosing a target are the two things worth shortening.

## For agents

```sh
termio-browser skill install          # into ./.claude/skills and ./.agents/skills
termio-browser skill install --global # into $HOME instead
```

The skill teaches the patterns that matter: read the accessibility tree before
acting, filter it before printing, poll instead of sleeping.

For MCP clients, run the server on stdio:

```sh
termio-browser mcp
```

## License

MIT
