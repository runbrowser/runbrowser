/* @meta
{
  "name": "weibo/hot",
  "description": "Get Weibo hot search / trending topics",
  "domain": "weibo.com",
  "args": {
    "count": {"required": false, "description": "Number of items to return (default: 30, max: 50)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site weibo/hot 20"
}
*/

async function(args) {
  const count = Math.min(parseInt(args.count) || 30, 50);

  const resp = await fetch('/ajax/statuses/hot_band', {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  const data = await resp.json();
  if (!data.ok) return {error: 'API error', hint: 'Not logged in?'};

  const bandList = data.data?.band_list || [];
  const items = bandList.slice(0, count).map((item, i) => ({
    rank: item.realpos || (i + 1),
    word: item.word,
    hot_value: item.num || 0,
    raw_hot: item.raw_hot || 0,
    category: item.category || '',
    label: item.label_name || '',
    is_new: !!item.is_new,
    url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent('#' + item.word + '#')
  }));

  const hotgov = data.data?.hotgov;
  const top = hotgov ? {
    word: hotgov.word || hotgov.name || '',
    url: hotgov.url || ''
  } : null;

  return {count: items.length, top, items};
}
