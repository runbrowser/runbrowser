/* @meta
{
  "name": "weibo/user_posts",
  "description": "Get a Weibo user's posts (timeline)",
  "domain": "weibo.com",
  "args": {
    "uid": {"required": true, "description": "User ID (numeric)"},
    "page": {"required": false, "description": "Page number (default: 1)"},
    "feature": {"required": false, "description": "Filter: 0=all, 1=original, 2=picture, 3=video, 4=music (default: 0)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site weibo/user_posts 1654184992"
}
*/

async function(args) {
  if (!args.uid) return {error: 'Missing argument: uid'};
  const page = parseInt(args.page) || 1;
  const feature = parseInt(args.feature) || 0;

  const resp = await fetch('/ajax/statuses/mymblog?uid=' + args.uid + '&page=' + page + '&feature=' + feature, {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  const data = await resp.json();
  if (!data.ok) return {error: 'API error: ' + (data.msg || 'unknown'), hint: 'Not logged in? Or user does not exist.'};

  const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

  const list = (data.data?.list || []).map(s => {
    const item = {
      id: s.idstr || String(s.id),
      mblogid: s.mblogid,
      text: s.text_raw || strip(s.text || ''),
      created_at: s.created_at,
      source: strip(s.source || ''),
      reposts_count: s.reposts_count || 0,
      comments_count: s.comments_count || 0,
      likes_count: s.attitudes_count || 0,
      is_long_text: !!s.isLongText,
      pic_count: s.pic_num || 0,
      url: 'https://weibo.com/' + args.uid + '/' + (s.mblogid || '')
    };

    if (s.retweeted_status) {
      const rt = s.retweeted_status;
      item.retweeted = {
        id: rt.idstr || String(rt.id),
        text: rt.text_raw || strip(rt.text || ''),
        user: rt.user?.screen_name || '[deleted]'
      };
    }

    return item;
  });

  return {
    uid: args.uid,
    page,
    total: data.data?.total || 0,
    count: list.length,
    posts: list
  };
}
