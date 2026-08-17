export const description = 'V2EX hot topics'

export const args = {
  limit: { type: 'number', default: 20, description: 'Number of topics' },
}

export const columns = ['rank', 'title', 'node', 'replies', 'author']

export async function run(ctx: any, args: any) {
  const limit = Math.min(args.limit || 20, 50)

  // Navigate first so the fetch below is same-origin and carries the user's
  // cookies — the whole reason this runs in a browser rather than in curl.
  await ctx.navigate('https://www.v2ex.com')

  return await ctx.evaluate(`
    const resp = await fetch('/api/topics/hot.json', { credentials: 'include' })
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const topics = await resp.json()
    topics.slice(0, ${limit}).map((t, i) => ({
      rank: i + 1,
      title: t.title,
      node: t.node?.title ?? '',
      replies: t.replies,
      author: t.member?.username ?? '',
      url: t.url,
    }))
  `)
}
