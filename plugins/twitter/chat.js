/* @meta
{
  "name": "twitter/chat",
  "description": "获取 Twitter DM 对话消息",
  "domain": "x.com",
  "args": {
    "conversation_id": {"required": true, "description": "Conversation ID (from URL, e.g. 115897222-2741527221)"},
    "count": {"required": false, "description": "Number of messages to return (default 50)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site twitter/chat 115897222-2741527221"
}
*/

async function(args) {
  if (!args.conversation_id) return {error: 'Missing argument: conversation_id', hint: 'Provide conversation ID from URL, e.g. 115897222-2741527221'};
  const ct0 = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('ct0='))?.split('=')[1];
  if (!ct0) return {error: 'No ct0 cookie', hint: 'Not logged into x.com. Open x.com and log in first.'};

  let convId = args.conversation_id;
  const urlMatch = convId.match(/\/chat\/([^\/?]+)/);
  if (urlMatch) convId = urlMatch[1];

  // ── Strategy: DOM first (handles E2E encrypted), API fallback ──

  const onConvPage = window.location.pathname === '/i/chat/' + convId;

  if (onConvPage) {
    // Wait for message list to render (E2E decryption may take a moment)
    let msgList = document.querySelector('[data-testid="dm-message-list"]');
    if (!msgList) {
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 300));
        msgList = document.querySelector('[data-testid="dm-message-list"]');
        if (msgList) break;
      }
    }
    if (!msgList) return {error: 'Message list not found', hint: 'Page may still be loading. Try again.'};

    // Wait a bit more for E2E decryption
    await new Promise(r => setTimeout(r, 500));

    // Extract participant info from header
    const header = document.querySelector('[data-testid="dm-conversation-header"]');
    const headerName = header?.textContent?.trim() || '';

    // Extract messages from DOM
    const textEls = document.querySelectorAll('[data-testid^="message-text-"]');
    const messages = [];
    const timeStampRegex = /(\d{2}:\d{2})\1$/;  // duplicated timestamps like "04:4904:49"

    for (const el of textEls) {
      const reqId = el.dataset.testid.replace('message-text-', '');
      let text = el.innerText || el.textContent || '';
      // Clean trailing duplicate timestamps
      text = text.replace(/(\d{2}:\d{2})\1$/, '').trim();

      // Determine sender: check if this message bubble has an avatar (= other person)
      // Twitter DM: messages from the other person have avatar images, yours don't
      const msgContainer = el.closest('[data-testid^="message-"]') || el.parentElement?.parentElement?.parentElement;
      // Walk up to find the message row - other person's messages typically appear on the left
      // We check for avatar image in nearby siblings
      let isOtherPerson = false;
      if (msgContainer) {
        const row = msgContainer.closest('[class]')?.parentElement;
        if (row) {
          const avatar = row.querySelector('img[src*="profile_images"]');
          if (avatar) isOtherPerson = true;
        }
      }

      // Try to extract time from a <time> element nearby
      let time = null;
      const parent = el.closest('[data-testid^="message-"]')?.parentElement;
      if (parent) {
        const timeEl = parent.querySelector('time');
        if (timeEl) time = timeEl.getAttribute('datetime');
      }

      messages.push({
        request_id: reqId,
        text,
        sender: isOtherPerson ? 'other' : 'self',
        time: time || undefined
      });
    }

    // Try to get participant names from the profile section at top of chat
    const profileSection = msgList.querySelector('[data-testid="UserCell"]') || msgList.firstElementChild;
    let otherName = headerName;
    let otherScreenName = '';
    const profileLink = msgList.querySelector('a[href^="/"]');
    if (profileLink) {
      const href = profileLink.getAttribute('href');
      if (href && !href.includes('/i/')) {
        otherScreenName = href.replace(/^\//, '').replace(/\/$/, '');
      }
    }
    // Also try from header text which usually has the name
    const nameHeading = header?.querySelector('span');
    if (nameHeading) otherName = nameHeading.textContent?.trim() || otherName;

    return {
      conversation_id: convId,
      participant: otherScreenName ? {name: otherName, screen_name: otherScreenName} : {name: otherName},
      encrypted: true,
      count: messages.length,
      messages
    };
  }

  // ── Fallback: API approach (works for non-encrypted conversations) ──

  const bearer = decodeURIComponent('AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA');
  const _h = {'Authorization':'Bearer '+bearer, 'X-Csrf-Token':ct0, 'X-Twitter-Auth-Type':'OAuth2Session', 'X-Twitter-Active-User':'yes'};

  const count = Math.min(parseInt(args.count) || 50, 100);
  const params = new URLSearchParams({
    include_profile_interstitial_type: '1', include_blocking: '1', include_blocked_by: '1',
    include_followed_by: '1', include_want_retweets: '1', include_mute_edge: '1',
    include_can_dm: '1', include_can_media_tag: '1', include_ext_is_blue_verified: '1',
    include_ext_verified_type: '1', include_ext_profile_image_shape: '1', skip_status: '1',
    dm_secret_conversations_enabled: 'false', krs_registration_enabled: 'true',
    cards_platform: 'Web-12', include_cards: '1', include_ext_alt_text: 'true',
    include_quote_count: 'true', include_reply_count: '1', tweet_mode: 'extended',
    include_ext_views: 'true', include_groups: 'true', include_inbox_timelines: 'true',
    count: String(count)
  });

  const url = '/i/api/1.1/dm/conversation/' + encodeURIComponent(convId) + '.json?' + params.toString();
  const resp = await fetch(url, {headers: _h, credentials: 'include'});
  if (!resp.ok) {
    if (resp.status === 404) return {error: 'Conversation not found', hint: 'Check the conversation ID: ' + convId};
    return {error: 'HTTP ' + resp.status, hint: 'Make sure you are logged in and have access to this conversation'};
  }
  const d = await resp.json();

  const users = {};
  for (const [uid, u] of Object.entries(d.conversation_timeline?.users || {})) {
    users[uid] = {id: uid, name: u.name, screen_name: u.screen_name};
  }

  const entries = d.conversation_timeline?.entries || [];
  const hasE2E = entries.some(e => e.trust_conversation);
  const messages = [];

  for (const entry of entries) {
    const msg = entry.message;
    if (!msg) continue;
    const md = msg.message_data;
    if (!md) continue;
    const senderId = md.sender_id;
    const sender = users[senderId];
    const mediaUrls = (md.attachment?.media || md.entities?.media || []).map(m => m.media_url_https || m.media_url).filter(Boolean);
    const urls = (md.entities?.urls || []).map(u => ({url: u.expanded_url || u.url, display: u.display_url}));

    messages.push({
      id: msg.id, sender_id: senderId,
      sender_name: sender?.name, sender_screen_name: sender?.screen_name,
      text: md.text || '',
      media: mediaUrls.length > 0 ? mediaUrls : undefined,
      urls: urls.length > 0 ? urls : undefined,
      created_at: md.time ? new Date(parseInt(md.time)).toISOString() : undefined
    });
  }

  messages.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const participants = Object.values(users).map(u => ({id: u.id, name: u.name, screen_name: u.screen_name}));

  const result = {
    conversation_id: convId, participants,
    count: messages.length, messages
  };

  if (hasE2E && messages.length <= 1) {
    result.encrypted = true;
    result.hint = 'This conversation is end-to-end encrypted. Only pre-encryption messages are shown via API. To get all messages, open the conversation in your browser first: https://x.com/i/chat/' + convId + ' , then run this command with --tab <tabId>';
  }

  return result;
}
