# RunBrowser

Drive the user's own Chrome — their tabs, their logins, their cookies — over the
Chrome DevTools Protocol.

There are two commands that touch a page, and neither of them is a verb you have
to learn: `cdp` sends any CDP method, `eval` runs JavaScript. Everything else
you might expect — click, type, read, screenshot, wait — is a CDP method you
already know. There is no `click`, no `snapshot`, no `@ref` system. That is
deliberate: a wrapper for each action is one more thing to get wrong, and Chrome
already has a complete, documented, stable API.

## Before anything else

```bash
runbrowser status
```

- **exits 0** — a browser is attached, go ahead.
- **exits 1** — no browser. Say so once and move on to work that doesn't need
  one. Do **not** walk the user through installing the extension mid-task; the
  app surfaces setup on its own.

## The commands

```
runbrowser cdp <Method> [params-json]   # the page API
runbrowser eval '<js>'                  # shorthand for Runtime.evaluate
runbrowser tab list|new|switch|close     # which target you're bound to
runbrowser status                       # is a browser attached
runbrowser session new|list|delete      # isolated state, one per agent
runbrowser help [command]               # same as --help
runbrowser skill install                # write the skill into ./.claude and ./.agents
```

Both `cdp` and `eval` read from stdin when the payload is long:

```bash
runbrowser cdp Runtime.evaluate <<'JSON'
{"expression": "document.title", "returnByValue": true}
JSON

runbrowser eval <<'JS'
Array.from(document.querySelectorAll('a')).map(a => a.href)
JS
```

Output is JSON on stdout, so pipe it:

```bash
runbrowser cdp Target.getTargets | jq '.targetInfos[] | select(.type=="page") | .url'
```

## Reading a page

**Use the accessibility tree, not a screenshot.** It is text, so you can filter
it, grep it, and keep it in context. A screenshot costs far more tokens and
can't be searched.

```bash
runbrowser cdp Accessibility.getFullAXTree \
  | jq '.nodes[] | select(.role.value=="button") | {name: .name.value, id: .backendDOMNodeId}'
```

**Filter before you print.** A real page is thousands of AX nodes. Never dump
the whole tree into your context — select the roles you care about first.

For text content, `eval` is usually shorter than a CDP round trip:

```bash
runbrowser eval 'document.querySelector("main").innerText.slice(0, 2000)'
```

## Acting on a page

Two workable styles. Prefer the first.

**1. Through the DOM, via `eval`** — short, reliable, and it works for
most forms and buttons:

```bash
runbrowser eval 'document.querySelector("#submit").click()'
runbrowser eval '(() => { const el = document.querySelector("#email"); el.value = "a@b.com"; el.dispatchEvent(new Event("input", {bubbles: true})); })()'
```

Note the `input` event — React and Vue ignore a bare `.value` assignment.

**2. Real input events, via CDP** — when the page needs genuine trusted events
(drag, canvas, hover-dependent menus, anti-automation checks). Find the element's
box, then click its centre:

```bash
# backendDOMNodeId comes from the AX tree above
runbrowser cdp DOM.getBoxModel '{"backendNodeId": 1234}'
runbrowser cdp Input.dispatchMouseEvent '{"type":"mousePressed","x":420,"y":310,"button":"left","clickCount":1}'
runbrowser cdp Input.dispatchMouseEvent '{"type":"mouseReleased","x":420,"y":310,"button":"left","clickCount":1}'
```

Typing with real key events:

```bash
runbrowser cdp Input.insertText '{"text":"hello"}'
runbrowser cdp Input.dispatchKeyEvent '{"type":"keyDown","key":"Enter","code":"Enter","windowsVirtualKeyCode":13}'
```

## Navigating and waiting

```bash
runbrowser cdp Page.navigate '{"url":"https://example.com"}'
```

`Page.navigate` returns as soon as navigation commits, **not** when the page is
usable. Poll for readiness rather than sleeping a fixed amount:

```bash
until [ "$(runbrowser eval 'document.readyState')" = complete ]; do sleep 0.2; done
```

For SPAs, `readyState` lies — poll for the thing you actually need:

```bash
until runbrowser eval 'document.querySelectorAll(".item").length >= 10' | grep -q true; do sleep 0.3; done
```

## Screenshots

Last resort, when the answer is genuinely visual (layout, rendering bugs):

```bash
runbrowser cdp Page.captureScreenshot | jq -r .data | base64 -d > shot.png
```

## Tabs

`Page.navigate` replaces the current tab's content. To leave the user's tab
alone, open a new one:

```bash
runbrowser tab new https://example.com   # opens and binds to it
runbrowser tab list                      # → marks the tab you're bound to
runbrowser tab 2                         # bind to tab 2
```

## Sessions

A session is isolated state bound to one tab. Tabs are shared across sessions;
state is not. Several agents can work in the same browser without stepping on
each other:

```bash
runbrowser session new     # → prints an id
runbrowser -s 3 tab list   # act inside session 3
```

Without `-s`, the CLI reuses an existing session or creates one.

## Rules

1. **Don't use the browser when HTTP would do.** If `curl` can fetch it, use
   `curl` — it's faster and doesn't touch the user's window.
2. **Filter AX output before printing it.**
3. **Read before you act.** Get the tree, find the node, then act on it — don't
   guess a selector and retry.
4. **Poll, don't sleep.** Fixed sleeps are either flaky or slow.
5. **Never launch a fresh Chrome.** The point is the user's logged-in browser.
6. **You're in the user's real browser.** Don't close their tabs, submit
   anything irreversible, or navigate away from work they have open. Open a new
   tab instead.

## When something needs a helper

If you find yourself writing the same CDP dance repeatedly for a site, write it
down as a skill rather than asking for a new CLI verb — that's how site
knowledge accumulates without the interface growing.

Site commands already installed on this machine are listed by:

```bash
runbrowser commands list
```
