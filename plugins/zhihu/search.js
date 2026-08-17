/* @meta
{
  "name": "zhihu/search",
  "description": "Search Zhihu for questions and answers",
  "domain": "www.zhihu.com",
  "args": {
    "keyword": {"required": true, "description": "Search keyword"},
    "count": {"required": false, "description": "Number of results (default: 10, max: 20)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site zhihu/search AI"
}
*/

async function(args) {
  if (!args.keyword) return {error: 'Missing argument: keyword'};
  const count = Math.min(parseInt(args.count) || 10, 20);
  const resp = await fetch('https://www.zhihu.com/api/v4/search_v3?q=' + encodeURIComponent(args.keyword) + '&t=general&offset=0&limit=' + count, {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  const d = await resp.json();

  // Strip HTML tags helper
  const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/<em>/g, '').replace(/<\/em>/g, '').trim();

  const results = (d.data || [])
    .filter(item => item.type === 'search_result')
    .map((item, i) => {
      const obj = item.object || {};
      const q = obj.question || {};
      return {
        rank: i + 1,
        type: obj.type,
        id: obj.id,
        title: strip(obj.title || q.name || ''),
        excerpt: strip(obj.excerpt || ''),
        url: obj.type === 'answer'
          ? 'https://www.zhihu.com/question/' + q.id + '/answer/' + obj.id
          : obj.type === 'article'
          ? 'https://zhuanlan.zhihu.com/p/' + obj.id
          : 'https://www.zhihu.com/question/' + obj.id,
        author: obj.author?.name || '',
        voteup_count: obj.voteup_count || 0,
        comment_count: obj.comment_count || 0,
        question_id: q.id || null,
        question_title: strip(q.name || ''),
        created_time: obj.created_time,
        updated_time: obj.updated_time
      };
    });

  return {
    keyword: args.keyword,
    count: results.length,
    has_more: !d.paging?.is_end,
    results
  };
}
