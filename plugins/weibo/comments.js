/* @meta
{
  "name": "weibo/comments",
  "description": "Get comments on a Weibo post",
  "domain": "weibo.com",
  "args": {
    "id": {"required": true, "description": "Post ID (numeric idstr)"},
    "count": {"required": false, "description": "Number of comments (default: 20, max: 50)"},
    "max_id": {"required": false, "description": "Pagination cursor (from previous response)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site weibo/comments 5274888946583083"
}
*/

async function(args) {
  if (!args.id) return {error: 'Missing argument: id'};
  const count = Math.min(parseInt(args.count) || 20, 50);

  let url = '/ajax/statuses/buildComments?flow=0&is_reload=1&id=' + args.id + '&is_show_bulletin=2&is_mix=0&count=' + count;
  if (args.max_id) url += '&max_id=' + args.max_id;

  const resp = await fetch(url, {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: resp.status === 404 ? 'Post not found' : 'Not logged in?'};
  const data = await resp.json();
  if (!data.ok) return {error: 'API error: ' + (data.msg || 'unknown'), hint: 'Not logged in?'};

  const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

  const comments = (data.data || []).map(c => ({
    id: c.idstr || String(c.id),
    text: strip(c.text || ''),
    created_at: c.created_at,
    likes_count: c.like_count || 0,
    reply_count: c.total_number || 0,
    user: {
      id: c.user?.id,
      screen_name: c.user?.screen_name,
      verified: c.user?.verified || false
    },
    reply_to: c.reply_comment ? {
      id: c.reply_comment.idstr || String(c.reply_comment.id),
      user: c.reply_comment.user?.screen_name || '',
      text: strip(c.reply_comment.text || '')
    } : null
  }));

  return {
    post_id: args.id,
    count: comments.length,
    max_id: data.max_id || null,
    has_more: !!data.max_id,
    comments
  };
}
