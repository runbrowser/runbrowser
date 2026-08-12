---
name: termio-browser
description: Drive the user's own Chrome — their tabs, logins and cookies — over the Chrome DevTools Protocol, via the `termio-browser` CLI. Use this instead of browser automation that spawns a fresh Chrome, and instead of webfetch/curl for JS-heavy or login-walled pages (Instagram, X, dashboards, lazy-loaded UIs). Run `termio-browser skill` for the full reference.
---

# Browser

The user's real browser, over CDP. Two commands touch a page: `cdp` sends any
CDP method, `eval` runs JavaScript. There is no `click`, no `snapshot`, no
`@ref` system. Navigation and screenshots are single CDP methods; clicking and
typing are short CDP sequences, documented in the full reference. A wrapper per
action is one more thing to get wrong.

## Check first

```bash
termio-browser status
```

Exit 0 means a browser is attached. Exit 1 means none is — say so once and
carry on with work that doesn't need a browser. Don't run the user through
extension setup mid-task.

## The whole surface

```bash
termio-browser cdp <Method> [params-json]    # the page API
termio-browser eval '<js>'                   # shorthand for Runtime.evaluate
termio-browser tab list|new|<index>|close     # which target you're bound to
termio-browser status                        # is a browser attached
termio-browser session new|list|delete       # isolated state, one per agent
termio-browser help [command]                # same as --help
```

## Minimal example

```bash
termio-browser tab new https://example.com
termio-browser eval 'document.title'
termio-browser cdp Accessibility.getFullAXTree \
  | jq '.nodes[] | select(.role.value=="button") | .name.value'
```

If `termio-browser` is not on PATH, use `npx @termio/browser@latest`.

## The three rules that matter most

1. **Read with the accessibility tree, not screenshots.** It's text — filter it
   with `jq` before printing. A full tree is thousands of nodes; never dump it
   into context.
2. **Poll, don't sleep.** `Page.navigate` resolves on commit, not on load — and
   `cdp` delivers no CDP *events*, so waiting means polling for a side effect.
3. **It's the user's real browser.** Open a new tab rather than navigating away
   from their work, and don't submit anything irreversible.

## Full reference

```bash
termio-browser skill
```

Covers input events vs DOM clicks, framework-safe form filling, SPA waiting,
sessions, and screenshots.
