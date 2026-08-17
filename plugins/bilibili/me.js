/* @meta
{
  "name": "bilibili/me",
  "description": "Get current Bilibili logged-in user info",
  "domain": "www.bilibili.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site bilibili/me"
}
*/

async function(args) {
  const resp = await fetch('https://api.bilibili.com/x/web-interface/nav', {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  const d = await resp.json();
  if (d.code !== 0) return {error: d.message || 'API error ' + d.code, hint: 'Not logged in?'};
  if (!d.data?.isLogin) return {error: 'Not logged in', hint: 'Please log in to bilibili.com first'};
  const u = d.data;
  const result = {
    mid: u.mid,
    username: u.uname,
    url: 'https://space.bilibili.com/' + u.mid,
    face: u.face,
    level: u.level_info?.current_level,
    coins: u.money,
    vip: u.vipType > 0,
    vip_type: u.vipType === 1 ? 'monthly' : u.vipType === 2 ? 'annual' : 'none',
    vip_label: u.vip_label?.text || null,
    moral: u.moral,
    email_verified: u.email_verified === 1,
    tel_verified: u.mobile_verified === 1,
    follower: null,
    following: null
  };
  try {
    const statResp = await fetch('https://api.bilibili.com/x/web-interface/nav/stat', {credentials: 'include'});
    const statData = await statResp.json();
    if (statData.code === 0 && statData.data) {
      result.follower = statData.data.follower;
      result.following = statData.data.following;
    }
  } catch(e) {}
  return result;
}
