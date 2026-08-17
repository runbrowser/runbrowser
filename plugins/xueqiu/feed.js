/* @meta
{
  "name": "xueqiu/feed",
  "description": "获取雪球首页时间线（关注用户的动态）",
  "domain": "xueqiu.com",
  "args": {
    "page": {"required": false, "description": "页码，默认 1"},
    "count": {"required": false, "description": "每页数量，默认 20"}
  },
  "readOnly": true,
  "example": "bb-browser site xueqiu/feed"
}
*/

async function(args) {
  var page = parseInt(args.page) || 1;
  var count = Math.min(parseInt(args.count) || 20, 50);
  var resp = await fetch('https://xueqiu.com/v4/statuses/home_timeline.json?page=' + page + '&count=' + count, {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  var d = await resp.json();

  var strip = function(html) {
    return (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  };

  var list = d.home_timeline || d.list || [];
  var items = list.slice(0, count).map(function(item) {
    var user = item.user || {};
    return {
      id: item.id,
      text: strip(item.description).substring(0, 200),
      url: 'https://xueqiu.com/' + user.id + '/' + item.id,
      author: user.screen_name,
      author_id: user.id,
      verified: user.verified_description || null,
      likes: item.fav_count,
      retweets: item.retweet_count,
      replies: item.reply_count,
      created_at: item.created_at ? new Date(item.created_at).toISOString() : null
    };
  });

  return {page: page, count: items.length, items: items};
}
