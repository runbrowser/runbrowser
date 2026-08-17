/* @meta
{
  "name": "github/me",
  "description": "获取当前 GitHub 登录用户信息",
  "domain": "github.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true
}
*/

async function(args) {
  const resp = await fetch('https://api.github.com/user', {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: resp.status === 401 ? 'Not logged into github.com' : 'API error'};
  const d = await resp.json();
  return {
    login: d.login, name: d.name, bio: d.bio,
    url: d.html_url || ('https://github.com/' + d.login),
    public_repos: d.public_repos, followers: d.followers, following: d.following,
    created_at: d.created_at
  };
}
