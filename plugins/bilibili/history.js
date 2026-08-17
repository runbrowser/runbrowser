/* @meta
{
  "name": "bilibili/history",
  "description": "Get Bilibili watch history",
  "domain": "www.bilibili.com",
  "args": {
    "count": {"required": false, "description": "Number of items (default: 20, max: 50)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site bilibili/history 10"
}
*/

async function(args) {
  const ps = Math.min(parseInt(args.count) || 20, 50);
  const resp = await fetch('https://api.bilibili.com/x/web-interface/history/cursor?ps=' + ps + '&type=archive', {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  const d = await resp.json();
  if (d.code !== 0) return {error: d.message || 'API error ' + d.code, hint: 'Not logged in?'};
  if (!d.data?.list) return {error: 'No history data', hint: 'Not logged in?'};

  const items = (d.data.list || []).map(h => {
    const progress = h.progress === -1 ? 'completed' : h.progress > 0 ? Math.floor(h.progress / 60) + ':' + String(h.progress % 60).padStart(2, '0') : 'not_started';
    const duration_text = h.duration > 0 ? Math.floor(h.duration / 60) + ':' + String(h.duration % 60).padStart(2, '0') : null;
    return {
      bvid: h.history?.bvid,
      title: h.title,
      author: h.author_name,
      author_mid: h.author_mid,
      cover: h.cover,
      duration: h.duration,
      duration_text,
      progress,
      progress_seconds: h.progress,
      view_at: h.view_at ? new Date(h.view_at * 1000).toISOString() : null,
      tag_name: h.tag_name,
      url: h.history?.bvid ? 'https://www.bilibili.com/video/' + h.history.bvid : null
    };
  });

  return {count: items.length, items};
}
