/* @meta
{
  "name": "linkedin/profile",
  "description": "获取 LinkedIn 用户 profile",
  "domain": "www.linkedin.com",
  "args": {
    "username": {"required": true, "description": "LinkedIn username (from URL linkedin.com/in/<username>)"}
  },
  "readOnly": true,
  "example": "bb-browser site linkedin/profile williamhgates"
}
*/

async function(args) {
  if (!args.username) return {error: 'Missing argument: username'};
  const csrf = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('JSESSIONID='))?.split('=')[1]?.replace(/"/g,'');
  if (!csrf) return {error: 'Not logged in', hint: 'Please log in to https://www.linkedin.com first.'};
  const _h = {'csrf-token': csrf, 'x-restli-protocol-version': '2.0.0'};

  const resp = await fetch('/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=' + encodeURIComponent(args.username) + '&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-20', {
    headers: _h, credentials: 'include'
  });
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: resp.status === 404 ? 'User not found' : 'Check username'};
  const d = await resp.json();
  const p = d.elements?.[0];
  if (!p) return {error: 'Profile not found'};
  const mp = p.miniProfile || p;
  return {
    firstName: p.multiLocaleFirstName?.en_US || mp.firstName,
    lastName: p.multiLocaleLastName?.en_US || mp.lastName,
    headline: p.multiLocaleHeadline?.en_US || mp.headline || p.headline,
    location: p.geoLocation?.geo?.defaultLocalizedName || p.location,
    industry: p.industryV2?.name?.locale?.en_US,
    profileUrl: 'https://www.linkedin.com/in/' + args.username
  };
}
