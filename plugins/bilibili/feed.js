/* @meta
{
  "name": "bilibili/feed",
  "description": "Get Bilibili dynamic feed (timeline from followed users)",
  "domain": "www.bilibili.com",
  "args": {
    "type": {"required": false, "description": "Filter type: all (default), video, article, draw"},
    "count": {"required": false, "description": "Max items to return (default: 20)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site bilibili/feed"
}
*/

async function(args) {
  const typeMap = {all: 'all', video: 'video', article: 'article', draw: 'draw'};
  const type = typeMap[args.type] || 'all';
  const maxCount = parseInt(args.count) || 20;
  const resp = await fetch('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?type=' + type + '&page=1', {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  const d = await resp.json();
  if (d.code !== 0) return {error: d.message || 'API error ' + d.code, hint: 'Not logged in?'};
  if (!d.data?.items?.length) return {error: 'No feed items', hint: 'Not logged in or not following anyone?'};

  const items = (d.data.items || []).slice(0, maxCount).map(item => {
    const author = item.modules?.module_author;
    const dynamic = item.modules?.module_dynamic;
    const stat = item.modules?.module_stat;
    const base = {
      id: item.id_str,
      type: item.type,
      url: 'https://www.bilibili.com/opus/' + item.id_str,
      author: author?.name,
      author_mid: author?.mid,
      author_face: author?.face,
      pub_time: author?.pub_ts ? new Date(author.pub_ts * 1000).toISOString() : null,
      pub_action: author?.pub_action,
      text: dynamic?.desc?.text || null,
      comment_count: stat?.comment?.count,
      forward_count: stat?.forward?.count,
      like_count: stat?.like?.count
    };

    // Video type
    if (item.type === 'DYNAMIC_TYPE_AV' && dynamic?.major?.archive) {
      const arc = dynamic.major.archive;
      base.video = {
        bvid: arc.bvid,
        title: arc.title,
        cover: arc.cover,
        duration_text: arc.duration_text,
        play: arc.stat?.play,
        danmaku: arc.stat?.danmaku,
        url: 'https://www.bilibili.com/video/' + arc.bvid
      };
    }

    // Draw/image type
    if (item.type === 'DYNAMIC_TYPE_DRAW' && dynamic?.major?.draw) {
      base.images = (dynamic.major.draw.items || []).map(img => img.src);
    }

    // Article type
    if (item.type === 'DYNAMIC_TYPE_ARTICLE' && dynamic?.major?.article) {
      const art = dynamic.major.article;
      base.article = {
        id: art.id,
        title: art.title,
        covers: art.covers,
        url: 'https://www.bilibili.com/read/cv' + art.id
      };
    }

    return base;
  });

  return {type, count: items.length, has_more: !!d.data.has_more, items};
}
