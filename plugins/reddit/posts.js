/* @meta
{
  "name": "reddit/posts",
  "description": "获取用户发帖列表（自动翻页）",
  "domain": "www.reddit.com",
  "args": {
    "username": {"required": false, "description": "Reddit username (defaults to current user)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site reddit/posts MorroHsu"
}
*/

async function(args) {
  let username = args.username;
  if (!username) {
    // /api/me.json no longer returns user info (2025+).
    // Extract user ID from cookie, then resolve username.
    const idMatch = document.cookie.match(/t2_([a-z0-9]+)_/);
    if (!idMatch) return {error: 'Cannot determine username', hint: 'Provide username or log in to reddit.com'};
    const userId = 't2_' + idMatch[1];
    const idResp = await fetch('/api/user_data_by_account_ids.json?ids=' + userId, {credentials: 'include'});
    if (idResp.ok) {
      const idData = await idResp.json();
      username = idData[userId]?.name;
    }
    if (!username) return {error: 'Cannot determine username', hint: 'Provide username or log in to reddit.com'};
  }

  let after = null, allPosts = [], page = 0;
  do {
    const url = '/user/' + username + '/submitted/.json?limit=100&raw_json=1' + (after ? '&after=' + after : '');
    const resp = await fetch(url, {credentials: 'include'});
    if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: resp.status === 404 ? 'User not found: ' + username : 'API error'};
    const d = await resp.json();
    if (!d.data?.children) return {error: 'Unexpected response', hint: 'Reddit may be rate-limiting or returning a login page'};
    const posts = d.data.children.map(c => ({
      id: c.data.name, title: c.data.title, subreddit: c.data.subreddit_name_prefixed,
      score: c.data.score, num_comments: c.data.num_comments, created_utc: c.data.created_utc,
      permalink: 'https://www.reddit.com' + c.data.permalink,
      selftext_preview: (c.data.selftext || '').substring(0, 200)
    }));
    allPosts = allPosts.concat(posts);
    after = d.data.after;
    page++;
    if (after) await new Promise(r => setTimeout(r, 500));
  } while (after && page < 20);

  return {total: allPosts.length, posts: allPosts};
}
