/* @meta
{
  "name": "youtube/comments",
  "description": "Get comments for a YouTube video",
  "domain": "www.youtube.com",
  "args": {
    "id": {"required": false, "description": "Video ID (defaults to current page video)"},
    "max": {"required": false, "description": "Max comments to return (default: 20)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site youtube/comments d56mG7DezGs"
}
*/

async function(args) {
  const currentUrl = location.href;
  let videoId = args.id;
  const max = Math.min(parseInt(args.max) || 20, 100);

  if (!videoId) {
    const match = currentUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (match) videoId = match[1];
  }
  if (!videoId) return {error: 'No video ID', hint: 'Provide a video ID or navigate to a YouTube video page'};

  const cfg = window.ytcfg?.data_ || {};
  const apiKey = cfg.INNERTUBE_API_KEY;
  const context = cfg.INNERTUBE_CONTEXT;
  if (!apiKey || !context) return {error: 'YouTube config not found', hint: 'Make sure you are on youtube.com'};

  // Step 1: Get comment continuation token
  let continuationToken = null;

  // Try from current page ytInitialData first
  if (currentUrl.includes('watch?v=' + videoId) && window.ytInitialData) {
    const results = window.ytInitialData.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
    const commentSection = results.find(i => i.itemSectionRenderer?.targetId === 'comments-section');
    continuationToken = commentSection?.itemSectionRenderer?.contents?.[0]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
  }

  // If not on the page, fetch via next API
  if (!continuationToken) {
    const nextResp = await fetch('/youtubei/v1/next?key=' + apiKey + '&prettyPrint=false', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({context, videoId})
    });
    if (!nextResp.ok) return {error: 'Failed to get video data: HTTP ' + nextResp.status};
    const nextData = await nextResp.json();
    const results = nextData.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
    const commentSection = results.find(i => i.itemSectionRenderer?.targetId === 'comments-section');
    continuationToken = commentSection?.itemSectionRenderer?.contents?.[0]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
  }

  if (!continuationToken) return {error: 'No comment section found', hint: 'Comments may be disabled for this video'};

  // Step 2: Fetch comments using the continuation token
  const commentResp = await fetch('/youtubei/v1/next?key=' + apiKey + '&prettyPrint=false', {
    method: 'POST',
    credentials: 'include',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({context, continuation: continuationToken})
  });

  if (!commentResp.ok) return {error: 'Failed to fetch comments: HTTP ' + commentResp.status};
  const commentData = await commentResp.json();

  // Parse comments from frameworkUpdates (new ViewModel format)
  const mutations = commentData.frameworkUpdates?.entityBatchUpdate?.mutations || [];
  const commentEntities = mutations.filter(m => m.payload?.commentEntityPayload);

  let headerInfo = null;
  const actions = commentData.onResponseReceivedEndpoints || [];
  for (const action of actions) {
    const items = action.reloadContinuationItemsCommand?.continuationItems || [];
    for (const item of items) {
      if (item.commentsHeaderRenderer) {
        headerInfo = item.commentsHeaderRenderer.countText?.runs?.map(r => r.text).join('') || '';
      }
    }
  }

  const comments = commentEntities.slice(0, max).map((m, i) => {
    const p = m.payload.commentEntityPayload;
    const props = p.properties || {};
    const author = p.author || {};
    const toolbar = p.toolbar || {};
    return {
      rank: i + 1,
      author: author.displayName || '',
      authorChannelId: author.channelId || '',
      text: (props.content?.content || '').substring(0, 500),
      publishedTime: props.publishedTime || '',
      likes: toolbar.likeCountNotliked || '0',
      replyCount: toolbar.replyCount || '0',
      isPinned: !!(p.pinnedText)
    };
  });

  return {
    videoId,
    commentCountText: headerInfo || '',
    fetchedCount: comments.length,
    comments
  };
}
