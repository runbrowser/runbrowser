/* @meta
{
  "name": "weibo/me",
  "description": "Get current logged-in Weibo user info",
  "domain": "weibo.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site weibo/me"
}
*/

async function(args) {
  // Try Vuex store first (fastest, no network)
  const app = document.querySelector('#app')?.__vue_app__;
  const store = app?.config?.globalProperties?.$store;
  const cfg = store?.state?.config?.config;

  if (cfg?.user && cfg.uid) {
    const u = cfg.user;
    const detail = await fetch('/ajax/profile/detail?uid=' + cfg.uid, {credentials: 'include'})
      .then(r => r.ok ? r.json() : null).catch(() => null);
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
      domain: u.domain || '',
      url: u.url || '',
      avatar: u.avatar_hd || u.avatar_large || '',
      profile_url: 'https://weibo.com' + (u.profile_url || '/u/' + u.id),
      birthday: d.birthday || '',
      created_at: d.created_at || '',
      ip_location: d.ip_location || '',
      company: d.company || '',
      credit: d.sunshine_credit?.level || ''
    };
  }

  // Fallback: fetch config API
  const resp = await fetch('/ajax/config/get_config', {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  const data = await resp.json();
  if (!data.ok || !data.data?.uid) return {error: 'Not logged in', hint: 'Please log in to weibo.com first'};
  return {error: 'User data not available from config', hint: 'Navigate to weibo.com and reload'};
}
