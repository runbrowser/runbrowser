/* @meta
{
  "name": "douban/comments",
  "description": "Get short reviews/comments for a Douban movie or TV show",
  "domain": "movie.douban.com",
  "args": {
    "id": {"required": true, "description": "Douban subject ID (e.g. 1292052)"},
    "sort": {"required": false, "description": "Sort order: new_score (default, hot), time (newest first)"},
    "count": {"required": false, "description": "Number of comments (default: 20, max: 50)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site douban/comments 1292052"
}
*/

async function(args) {
  if (!args.id) return {error: 'Missing argument: id'};
  const id = String(args.id).trim();
  const sort = args.sort || 'new_score';
  const count = Math.min(parseInt(args.count) || 20, 50);

  if (sort !== 'new_score' && sort !== 'time') {
    return {error: 'Invalid sort. Use "new_score" (hot) or "time" (newest)'};
  }

  const url = 'https://movie.douban.com/j/subject/' + id + '/comments?start=0&limit=' + count + '&status=P&sort=' + sort;

  const resp = await fetch(url, {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  const d = await resp.json();

  if (d.retcode !== 1 || !d.result) return {error: 'Failed to fetch comments', hint: 'Invalid ID or not logged in?'};

  const ratingMap = {'1': '很差', '2': '较差', '3': '还行', '4': '推荐', '5': '力荐'};

  const comments = (d.result.normal || []).map(function(c) {
    var userId = c.user?.path?.match(/people\/([^/]+)/)?.[1];
    return {
      id: c.id,
      author: c.user?.name || '',
      author_id: userId || '',
      rating: c.rating ? parseInt(c.rating) : null,
      rating_label: c.rating_word || ratingMap[c.rating] || '',
      content: c.content || '',
      votes: c.votes || 0,
      date: c.time || ''
    };
  });

  return {
    subject_id: id,
    sort: sort,
    total: d.result.total_num || 0,
    count: comments.length,
    comments: comments
  };
}
