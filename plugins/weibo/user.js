/* @meta
{
  "name": "weibo/user",
  "description": "Get Weibo user profile by uid (numeric) or screen_name",
  "domain": "weibo.com",
  "args": {
    "id": {"required": true, "description": "User ID (numeric uid) or screen name"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site weibo/user 1654184992"
}
*/

async function(args) {
  if (!args.id) return {error: 'Missing argument: id', hint: 'Provide a numeric uid or screen_name'};

  // Auto-detect: numeric string = uid, otherwise screen_name
  const isUid = /^\d+$/.test(args.id);
  const query = isUid ? 'uid=' + args.id : 'screen_name=' + encodeURIComponent(args.id);

  // Fetch basic profile info
  const resp = await fetch('/ajax/profile/info?' + query, {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  const data = await resp.json();
  if (!data.ok) return {error: 'User not found', hint: 'Check uid or screen_name'};

  const u = data.data?.user;
  if (!u) return {error: 'User not found', hint: 'Check uid or screen_name'};

  // Fetch detailed profile info
  const detailResp = await fetch('/ajax/profile/detail?uid=' + u.id, {credentials: 'include'});
  const detail = detailResp.ok ? await detailResp.json() : null;
  const d = detail?.data || {};

  return {
    id: u.id,
    screen_name: u.screen_name,
    description: u.description || d.description || '',
    location: u.location || '',
    gender: u.gender === 'm' ? 'male' : u.gender === 'f' ? 'female' : 'unknown',
    followers_count: u.followers_count,
    following_count: u.friends_count,
    statuses_count: u.statuses_count,
    verified: u.verified || false,
    verified_type: u.verified_type,
    verified_reason: u.verified_reason || '',
    domain: u.domain || '',
    url: u.url || '',
    avatar: u.avatar_hd || u.avatar_large || '',
    profile_url: 'https://weibo.com' + (u.profile_url || '/u/' + u.id),
    birthday: d.birthday || '',
    created_at: d.created_at || '',
    ip_location: d.ip_location || '',
    company: d.company || '',
    credit: d.sunshine_credit?.level || '',
    following: u.following || false,
    follow_me: u.follow_me || false,
    mbrank: u.mbrank || 0,
    svip: u.svip || 0
  };
}
