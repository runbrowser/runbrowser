/* @meta
{
  "name": "xueqiu/hot",
  "description": "获取雪球热门动态",
  "domain": "xueqiu.com",
  "args": {
    "count": {"required": false, "description": "返回数量，默认 20，最大 50"}
  },
  "readOnly": true,
  "example": "bb-browser site xueqiu/hot 10"
}
*/

async function(args) {
  var count = Math.min(parseInt(args.count) || 20, 50);
  var resp = await fetch('https://xueqiu.com/statuses/hot/listV3.json?source=hot&page=1', {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  var d = await resp.json();
  var list = (d.list || []).slice(0, count);

  var strip = function(html) {
    return (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  };

  var items = list.map(function(item, i) {
    var user = item.user || {};
    return {
      rank: i + 1,
      id: item.id,
      text: strip(item.description).substring(0, 200),
      url: 'https://xueqiu.com/' + user.id + '/' + item.id,
      author: user.screen_name,
      author_id: user.id,
      likes: item.fav_count,
      retweets: item.retweet_count,
      replies: item.reply_count,
      created_at: item.created_at ? new Date(item.created_at).toISOString() : null
    };
  });

  return {count: items.length, items: items};
}
