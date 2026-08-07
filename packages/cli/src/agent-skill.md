---
name: runbrowser
description: Drive the user's own Chrome — their tabs, logins and cookies — over the Chrome DevTools Protocol, via the `runbrowser` CLI. Use this instead of browser automation that spawns a fresh Chrome, and instead of webfetch/curl for JS-heavy or login-walled pages (Instagram, X, dashboards, lazy-loaded UIs). Run `runbrowser skill` for the full reference.
---

# RunBrowser

The user's real browser, over CDP. Two commands touch a page: `cdp` sends any
CDP method, `eval` runs JavaScript. There is no `click`, no `snapshot`, no
`@ref` system — those are all CDP methods you already know, and a wrapper per
action is one more thing to get wrong.

## Check first

```bash
runbrowser status
```

Exit 0 means a browser is attached. Exit 1 means none is — say so once and
carry on with work that doesn't need a browser. Don't run the user through
extension setup mid-task.

## The whole surface

```bash
runbrowser cdp <Method> [params-json]    # the page API
runbrowser eval '<js>'                   # shorthand for Runtime.evaluate
runbrowser tab list|new|switch|close      # which target you're bound to
runbrowser status                        # is a browser attached
runbrowser session new|list|delete       # isolated state, one per agent
runbrowser help [command]                # same as --help
```

## Minimal example

```bash
runbrowser tab new https://example.com
runbrowser eval 'document.title'
runbrowser cdp Accessibility.getFullAXTree \
  | jq '.nodes[] | select(.role.value=="button") | .name.value'
```

If `runbrowser` is not on PATH, use `npx @jiweiyuan/runbrowser@latest`.

## The three rules that matter most

1. **Read with the accessibility tree, not screenshots.** It's text — filter it
   with `jq` before printing. A full tree is thousands of nodes; never dump it
   into context.
2. **Poll, don't sleep.** `Page.navigate` returns on commit, not on load.
3. **It's the user's real browser.** Open a new tab rather than navigating away
   from their work, and don't submit anything irreversible.

## Full reference

```bash
runbrowser skill
```

Covers input events vs DOM clicks, framework-safe form filling, SPA waiting,
sessions, and screenshots.
