# Plugins

Site commands that ship with termio browser. Each is a folder of `.ts` files:

```
plugins/<site>/<name>.ts   ->   termio-browser <site> <name>
```

Install one:

```sh
termio-browser commands install v2ex                       # from this repo
termio-browser commands install v2ex --repo owner/name     # from anyone's
```

Installed plugins land in `~/.termio/browser/commands/<site>/`. Anything you
drop there yourself works the same way — installing is only a download.

## Writing one

```ts
export const description = 'V2EX hot topics'
export const args = { limit: { type: 'number', default: 20 } }
export const columns = ['rank', 'title', 'replies']

export async function run(ctx, args) {
  // Navigate first: the fetch below is same-origin and carries the user's
  // cookies, which is the whole reason this runs in a browser and not in curl.
  await ctx.navigate('https://www.v2ex.com')
  return await ctx.evaluate(`
    const resp = await fetch('/api/topics/hot.json', { credentials: 'include' })
    const topics = await resp.json()
    topics.slice(0, ${'$'}{args.limit}).map((t, i) => ({ rank: i + 1, title: t.title, replies: t.replies }))
  `)
}
```

`ctx` gives you `navigate(url)`, `evaluate(code)` and `wait(ms)`. The code you
pass to `evaluate` runs in the page, so it can use `fetch` with the user's
session, read the DOM, or call the site's own JavaScript.

Two things worth knowing:

- **Relative URLs.** `fetch('/api/...')` after navigating to the site is
  same-origin and carries cookies. An absolute URL to another host is not, and
  is the most common reason a plugin returns nothing.
- **Prefer the site's own API** over scraping its markup. Class names change
  every deploy; a JSON endpoint the site's own frontend calls does not.
