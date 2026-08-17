# Plugins

Site commands that ship with termio browser — 144 of them across 50 sites.

```
plugins/<site>/<name>.js   ->   termio-browser <site> <name>
```

```sh
termio-browser commands list
termio-browser commands install v2ex
termio-browser v2ex hot --count 5
```

Installed plugins land in `~/.termio/browser/commands/<site>/`. Anything you
drop there yourself works the same way — installing is only a download.

From somewhere else:

```sh
termio-browser commands install <site> --repo owner/name [--path <dir>]
```

`--path ""` for a repository that keeps adapters at its root.

## Two formats

**`@meta` + a bare async function**, evaluated *in the page*. This is what
almost everything here uses, and what to write for a new one:

```js
/* @meta
{
  "name": "v2ex/hot",
  "description": "V2EX hot topics",
  "domain": "www.v2ex.com",
  "args": { "count": { "type": "number", "description": "How many" } }
}
*/
async function(args) {
  const resp = await fetch('/api/topics/hot.json', { credentials: 'include' })
  const topics = await resp.json()
  return topics.slice(0, args.count || 20).map((t, i) => ({ rank: i + 1, title: t.title }))
}
```

`domain` is the load-bearing field. The function runs on that origin, so
`fetch` is same-origin and carries the user's cookies, `document` is that
site's DOM, and the page's own JavaScript is in scope. **Absolute URLs to
another host are the most common reason an adapter returns nothing** — the
browser refuses them, correctly, because you are asking to be someone else.

**A module exporting `run(ctx, args)`**, evaluated on the host, is also
supported. `ctx` gives `navigate(url)`, `evaluate(code)` and `wait(ms)`. It
costs a round trip per call, so prefer the format above unless you need to
orchestrate across several pages.

## Notes

- A leading underscore (`_helper.js`) marks a file that is not a command.
- Prefer the site's own JSON API over scraping markup. Class names change
  every deploy; an endpoint the site's own frontend calls does not.
- `args` may be the loose form (a description string per name) or the typed
  `params` form. Both are read; `params` wins where both are present.

## Provenance

Adapted from [bb-sites](https://github.com/epiral/bb-sites), the same author's
adapter collection for bb-browser. The `@meta` format is theirs, which is why
`--repo epiral/bb-sites` also works directly.
