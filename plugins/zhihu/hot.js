/* @meta
{
  "name": "zhihu/hot",
  "description": "Get Zhihu hot list (trending topics)",
  "domain": "www.zhihu.com",
  "args": {
    "count": {"required": false, "description": "Number of items to return (default: 20, max: 50)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site zhihu/hot 10"
}
*/

async function(args) {
  const count = Math.min(parseInt(args.count) || 20, 50);
  const resp = await fetch('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50', {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  const d = await resp.json();
  const items = (d.data || []).slice(0, count).map((item, i) => {
    const t = item.target || {};
    return {
      rank: i + 1,
      id: t.id,
      title: t.title,
      url: 'https://www.zhihu.com/question/' + t.id,
      excerpt: t.excerpt || '',
      answer_count: t.answer_count,
      follower_count: t.follower_count,
      heat: item.detail_text || '',
      trend: item.trend === 0 ? 'stable' : item.trend > 0 ? 'up' : 'down',
      is_new: item.debut || false
    };
  });
  return {count: items.length, items};
}
