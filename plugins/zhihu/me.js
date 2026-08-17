/* @meta
{
  "name": "zhihu/me",
  "description": "Get current logged-in Zhihu user info",
  "domain": "www.zhihu.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site zhihu/me"
}
*/

async function(args) {
  const resp = await fetch('https://www.zhihu.com/api/v4/me', {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  const u = await resp.json();
  return {
    id: u.id,
    uid: u.uid,
    name: u.name,
    url: 'https://www.zhihu.com/people/' + u.url_token,
    url_token: u.url_token,
    headline: u.headline,
    gender: u.gender === 1 ? 'male' : u.gender === 0 ? 'female' : 'unknown',
    ip_info: u.ip_info,
    avatar_url: u.avatar_url,
    is_vip: u.vip_info?.is_vip || false,
    answer_count: u.answer_count,
    question_count: u.question_count,
    articles_count: u.articles_count,
    columns_count: u.columns_count,
    favorite_count: u.favorite_count,
    voteup_count: u.voteup_count,
    thanked_count: u.thanked_count,
    creation_count: u.creation_count,
    notifications: {
      default: u.default_notifications_count,
      follow: u.follow_notifications_count,
      vote_thank: u.vote_thank_notifications_count,
      messages: u.messages_count
    }
  };
}
