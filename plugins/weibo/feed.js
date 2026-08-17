/* @meta
{
  "name": "weibo/feed",
  "description": "Get Weibo home timeline (posts from followed users)",
  "domain": "weibo.com",
  "args": {
    "count": {"required": false, "description": "Number of posts (default: 15, max: 50)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site weibo/feed 10"
}
*/

async function(args) {
  const count = Math.min(parseInt(args.count) || 15, 50);

  // Get user uid and list_id from Vuex store
  const app = document.querySelector('#app')?.__vue_app__;
  const store = app?.config?.globalProperties?.$store;
  const cfg = store?.state?.config?.config;
  const uid = cfg?.uid;
  if (!uid) return {error: 'Not logged in', hint: 'Please log in to weibo.com first'};

  const listId = '10001' + uid;
  const resp = await fetch('/ajax/feed/unreadfriendstimeline?list_id=' + listId + '&refresh=4&since_id=0&count=' + count, {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  const data = await resp.json();
  if (!data.ok) return {error: 'API error: ' + (data.msg || 'unknown'), hint: 'Not logged in?'};

  const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

  const statuses = (data.statuses || []).slice(0, count).map(s => {
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
      user: {
        id: s.user?.id,
        screen_name: s.user?.screen_name,
        verified: s.user?.verified || false
      },
      url: 'https://weibo.com/' + (s.user?.id || '') + '/' + (s.mblogid || '')
    };

    // Include retweet info if present
    if (s.retweeted_status) {
      const rt = s.retweeted_status;
      item.retweeted = {
        id: rt.idstr || String(rt.id),
        text: rt.text_raw || strip(rt.text || ''),
        user: rt.user?.screen_name || '[deleted]',
        reposts_count: rt.reposts_count || 0,
        comments_count: rt.comments_count || 0,
        likes_count: rt.attitudes_count || 0
      };
    }

    return item;
  });

  return {count: statuses.length, statuses};
}
