# RFC: Minimal CDP Surface

> Status: **Implemented** (2026-08-07)
> Supersedes: [cli-redesign.md](./cli-redesign.md)

## The change

The verb layer is gone. `click`, `fill`, `type`, `press`, `select`, `check`,
`uncheck`, `hover`, `focus`, `scroll`, `drag`, `upload`, `download`, `viewport`,
`wait`, `find`, `frame`, `navigate`, `back`, `forward`, `reload`, `snapshot`,
`screenshot`, `get`, `is`, `diff` and `record` no longer exist, along with the
`@ref` system that fed them.

What remains:

```
cdp <Method> [params-json]    # the page API
eval '<js>'                   # shorthand for Runtime.evaluate
tab list|new|switch|close      # which target the session is bound to
status                        # is a browser attached
session new|list|delete       # isolated state, one per agent
```

Plus `config`, `serve`, `logfile`, `skill`, `commands` and `help` — none of
which touch a page.

`skill` gained subcommands rather than staying a printer:

```
skill                     # print the reference
skill install             # write SKILL.md into ./.claude and ./.agents
skill install --global    # ...into $HOME instead
skill uninstall
skill path
```

A shrinking interface raises the stakes on the skill file — it is now the only
place the CDP patterns are written down — so getting it in front of the agent
can't depend on a third-party installer (`npx skills add`). Install is
idempotent and refuses to touch a `SKILL.md` without our ownership marker, so a
copy the user has edited or symlinked to a checkout survives both install and
uninstall.

It installs into the **current project** by default, not `$HOME`. A skill sitting
next to the code it is used on gets committed, reviewed and versioned with that
repo, and installing it never silently changes agent behaviour in every other
checkout on the machine. `--global` is the opt-in.

`help` exists because agents type `termio-browser help` before `termio-browser --help`,
and answering that guess with "Unknown command" costs a turn.

## Why

**Every wrapper is a decision made on the model's behalf.** A `click(ref)` verb
encodes one answer to "how do you click" — resolve a ref, get a box, dispatch a
mouse event. When a page needs a different answer (a trusted event sequence, a
framework-safe value assignment, a shadow-DOM traversal), the verb is not just
unhelpful, it is in the way. The model then works around the abstraction instead
of working the problem.

**The model already knows CDP.** It is documented, stable, versioned by Chrome,
and heavily represented in training data. A hand-rolled verb vocabulary is
neither documented outside this repo nor stable, and every one of its names is
something the model has to be taught in a skill file.

**Cost is real and recurring.** Each verb existed in five places at once: a CLI
registration, a client method, an HTTP route, a server-side CDP implementation,
and a line of documentation. Twenty-six verbs is a hundred-odd things to keep
consistent, and they drifted — `/api/tab/new`, `/api/tab/switch` and
`/api/tab/close` were being called by the client with no route registered to
serve them.

**Refs and verbs are one system.** `@e5` labels are worthless without a `click
@e5` to consume them, so the snapshot layer went with the verbs rather than
being kept half-alive.

## The pole this does not occupy

`remorses/playwriter` — which this project began as a fork of — is neither a
verb layer nor raw CDP. It runs **real Playwright** in a stateful sandbox, so
the agent writes `await page.locator('aria-ref=e5').click()`.

The argument above does not dispose of that, and it is worth being explicit
rather than quietly claiming the minimal design wins on every axis:

- Playwright is **not a vocabulary we invented.** It is a de facto standard with
  more training-data presence than raw CDP calls.
- `page.click()` is not a naive wrapper around `Input.dispatchMouseEvent` — it
  is auto-waiting plus actionability checks (visible, stable, enabled, receives
  events) refined over years. `skill.md` now describes those steps in prose,
  which is a hand-written, unverified reimplementation of them.
- `aria-ref` handles are real grounding, and `waitForResponse` / `Promise.all`
  are the event-driven waiting this design does not have at all.

So on ergonomics, playwriter is ahead. What this design buys instead is
dependency-freedom: no Node runtime, and no dependency on
`@xmorse/playwright-core` — a **fork** of playwright-core, because driving a
browser through an extension relay needs patches upstream does not carry.

That trade is right for a host that ships no JavaScript runtime. It is not
obviously right for a standalone CLI, where Node is already present. If this
ever ships as a portable tool for non-termio agents, revisit it — the honest
comparison is against playwriter, not against the verb layer that was removed.

## What was deliberately kept

- **`eval`.** It is `Runtime.evaluate` with the result marshalled to text.
  Reading a value out of a page is the single most common operation and the raw
  CDP response shape is genuinely awkward. This is sugar, not abstraction.
- **`tab` and `status`.** Neither is about page content. Which target a session
  is bound to, and whether a browser is attached at all, are facts the caller
  cannot derive from a CDP result — the server holds them.
- **Site commands** (`runbrowser/commands`). A different audience from the agent
  CDP path, with a published `CommandContext` contract. Its `navigate` was
  reimplemented on raw CDP plus a `document.readyState` poll rather than
  dropped.
- **The Playwright bridge**, in the sense that its code was not deleted — the
  argument here serves Playwright users, not agents. Note it is currently *not
  registered* in `server.ts` (nor is the extension WS route); that regression
  came in with the in-flight work this branch was built on, so "kept" means
  "not removed by this change", not "working".
- **The MCP server**, reduced to `cdp` / `eval` / `tab` / `status` / `skill` /
  `command`. MCP clients need a tool schema, so a passthrough tool is the right
  shape there too.

## Where the knowledge goes instead

Removing the verbs does not remove what the verbs knew. Filling a React input
still needs an `input` event; SPAs still need polling rather than
`readyState`. That knowledge moved into `skill.md` as patterns, and into
per-site skills for anything site-specific.

This is the deliberate trade: **a small interface plus an accumulating body of
written patterns, rather than a large interface plus the illusion that the
patterns are unnecessary.** The interface stops growing; the knowledge keeps
growing. Only the second one benefits from being large.

## Numbers

| | Before | After |
|---|---|---|
| CLI commands | 38 | 11 |
| HTTP command routes | 28 | 6 (2 page-facing, 4 tab) |
| MCP tools | 7 | 6 |
| `skill.md` | 1278 lines | 241 lines |

## Known not shippable as merged

Two blockers predate this change and are inherited from the in-flight work in
`84586e1`, not introduced here:

- `packages/server` does not compile (83 `tsc` errors in `state.ts`,
  `server-context.ts`, `cdp-discovery.ts`, `playwright-ws.ts`), and the root
  `typecheck` script does not include the server package, which is why this was
  invisible.
- `POST /api/session/new` requires `cdpUrl`, while `RelayApiClient.createSession`
  sends only `extensionId` — so every first `cdp`, `eval` or `tab` call ends in
  HTTP 400. Only `status` works end to end.

Defects introduced *by* this change and still open: implicit stdin makes a
no-param `cdp` hang under a held-open pipe; tab indices are derived from
`Target.getTargets` order and are not stable across calls; the skill installer's
ownership marker proves origin but not absence of edits, so it will overwrite an
edited marked file.
