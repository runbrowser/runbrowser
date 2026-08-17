/* @meta
{
  "name": "weibo/post",
  "description": "Get a single Weibo post by ID (numeric or mblogid)",
  "domain": "weibo.com",
  "args": {
    "id": {"required": true, "description": "Post ID (numeric idstr) or mblogid (short alphanumeric ID from URL)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site weibo/post QvqcCrCyL"
}
*/

async function(args) {
  if (!args.id) return {error: 'Missing argument: id'};

  const resp = await fetch('/ajax/statuses/show?id=' + encodeURIComponent(args.id), {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: resp.status === 404 ? 'Post not found or deleted' : 'Not logged in?'};
  const s = await resp.json();
  if (!s.ok && !s.idstr) return {error: 'Post not found', hint: 'Check the post ID'};

  const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

  // Fetch long text if needed
  let fullText = s.text_raw || strip(s.text || '');
  if (s.isLongText) {
    const ltResp = await fetch('/ajax/statuses/longtext?id=' + s.idstr, {credentials: 'include'});
    if (ltResp.ok) {
      const lt = await ltResp.json();
      if (lt.data?.longTextContent) {
        fullText = strip(lt.data.longTextContent);
      }
    }
  }

  const result = {
    id: s.idstr || String(s.id),
    mblogid: s.mblogid,
    text: fullText,
    created_at: s.created_at,
    source: strip(s.source || ''),
    reposts_count: s.reposts_count || 0,
    comments_count: s.comments_count || 0,
    likes_count: s.attitudes_count || 0,
    is_long_text: !!s.isLongText,
    pic_count: s.pic_num || 0,
    pics: (s.pic_ids || []).map(pid => {
      const info = s.pic_infos?.[pid];
      return info?.large?.url || info?.original?.url || null;
    }).filter(Boolean),
    user: {
      id: s.user?.id,
      screen_name: s.user?.screen_name,
      verified: s.user?.verified || false,
      verified_reason: s.user?.verified_reason || '',
      followers_count: s.user?.followers_count
    },
    url: 'https://weibo.com/' + (s.user?.id || '') + '/' + (s.mblogid || '')
  };

  // Include retweet info
  if (s.retweeted_status) {
    const rt = s.retweeted_status;
    result.retweeted = {
      id: rt.idstr || String(rt.id),
      mblogid: rt.mblogid,
      text: rt.text_raw || strip(rt.text || ''),
      user: {
        id: rt.user?.id,
        screen_name: rt.user?.screen_name || '[deleted]'
      },
      reposts_count: rt.reposts_count || 0,
      comments_count: rt.comments_count || 0,
      likes_count: rt.attitudes_count || 0,
      url: 'https://weibo.com/' + (rt.user?.id || '') + '/' + (rt.mblogid || '')
    };
  }

  return result;
}
