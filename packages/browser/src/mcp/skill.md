# runbrowser

Drive the user's own Chrome — their tabs, their logins, their cookies — over the
Chrome DevTools Protocol.

There are two commands that touch a page, and neither is a verb you have to
learn: `cdp` sends any CDP method, `eval` runs JavaScript. There is no `click`,
no `snapshot`, no `@ref` system — a wrapper per action is one more thing to get
wrong, and Chrome's protocol is complete and documented.

Some of what you might expect *is* a single CDP method (`Page.navigate`,
`Page.captureScreenshot`). Clicking and waiting are not — they are short
sequences of CDP calls, and the recipes are below. CDP itself is versioned by
Chrome but tip-of-tree domains do change; if a method is missing, check the
protocol version rather than assuming this tool is broken.

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
runbrowser eval '<js>'                  # JavaScript in the page (see caveat below)
runbrowser tab list|new|<index>|close    # which target you're bound to
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

`cdp` prints the CDP result as JSON on stdout, so pipe it:

```bash
runbrowser cdp Target.getTargets | jq '.targetInfos[] | select(.type=="page") | .url'
```

`eval` prints the value as plain text, not JSON — `runbrowser eval 'document.title'`
prints the title, unquoted. Use `--json` if you need it wrapped.

### `eval` caveat — it is not a transparent `Runtime.evaluate`

If your code contains a `;` or starts with `return`, it is wrapped in an async
function before evaluation, and the wrapper does not return the last expression:

```bash
runbrowser eval 'document.title'    # → the title
runbrowser eval 'document.title;'   # → empty. The trailing ; changed the semantics.
```

A `;` inside a string literal triggers the same wrapping. When writing more than
one statement, return explicitly:

```bash
runbrowser eval 'const t = document.title; return t.toUpperCase()'
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
```

Filling an input is the case that bites. A bare `.value = ...` is ignored by
React, and so is `.value` plus a dispatched `input` event — React tracks the
last value it set on the node and skips the change as a no-op. Go through the
native prototype setter so React's tracker sees a real change:

```bash
runbrowser eval <<'JS'
const el = document.querySelector("#email");
const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, "a@b.com");
el.dispatchEvent(new Event("input", { bubbles: true }));
return el.value;
JS
```

For a plain (non-framework) form, `.value` plus an `input` event is enough.

**2. Real input events, via CDP** — when the page needs genuine trusted events
(drag, canvas, hover-dependent menus, anti-automation checks). Find the element's
box, then click its centre:

```bash
# backendDOMNodeId comes from the AX tree above.
# Scroll it into view first — box coordinates are viewport-relative, so a box
# from before a scroll points somewhere else after one.
runbrowser cdp DOM.scrollIntoViewIfNeeded '{"backendNodeId": 1234}'
runbrowser cdp DOM.getBoxModel '{"backendNodeId": 1234}'
# centre of the content quad: [x1,y1, x2,y2, x3,y3, x4,y4]
runbrowser cdp Input.dispatchMouseEvent '{"type":"mouseMoved","x":420,"y":310}'
runbrowser cdp Input.dispatchMouseEvent '{"type":"mousePressed","x":420,"y":310,"button":"left","clickCount":1}'
runbrowser cdp Input.dispatchMouseEvent '{"type":"mouseReleased","x":420,"y":310,"button":"left","clickCount":1}'
```

This is a sequence, not an atomic click: nothing checks that the element is
visible, enabled, or unobstructed by an overlay. If the click seems to do
nothing, verify with a targeted `eval` rather than clicking again.

Typing with real key events — focus the field first, and always pair `keyDown`
with `keyUp`, or the page sees a key that never came back up:

```bash
runbrowser cdp DOM.focus '{"backendNodeId": 1234}'
runbrowser cdp Input.insertText '{"text":"hello"}'
runbrowser cdp Input.dispatchKeyEvent '{"type":"keyDown","key":"Enter","code":"Enter","windowsVirtualKeyCode":13}'
runbrowser cdp Input.dispatchKeyEvent '{"type":"keyUp","key":"Enter","code":"Enter","windowsVirtualKeyCode":13}'
```

## Navigating and waiting

```bash
runbrowser cdp Page.navigate '{"url":"https://example.com"}'
```

`Page.navigate` resolves once the navigation has been initiated and a frame is
committed — it does not promise the document is loaded or usable, and the
protocol makes no guarantee about how much has rendered. Poll for readiness
rather than sleeping a fixed amount:

```bash
until [ "$(runbrowser eval 'document.readyState')" = complete ]; do sleep 0.2; done
```

For SPAs, `readyState` lies — poll for the thing you actually need:

```bash
until runbrowser eval 'document.querySelectorAll(".item").length >= 10' | grep -q true; do sleep 0.3; done
```

### What you cannot wait on

`cdp` sends commands and returns their results. It does **not** deliver CDP
*events*, so there is no way to wait on `Page.loadEventFired`,
`Page.javascriptDialogOpening`, `Browser.downloadProgress`, popups, or new
target attachment. Anything event-driven has to be reduced to polling for an
observable side effect, as above — and downloads and dialogs may simply not be
workable from here. Say so rather than retrying.

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
