/* @meta
{
  "name": "youtube/video",
  "description": "Get detailed info for a YouTube video (from current page or by video ID)",
  "domain": "www.youtube.com",
  "args": {
    "id": {"required": false, "description": "Video ID (defaults to current page video)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site youtube/video d56mG7DezGs"
}
*/

async function(args) {
  const currentUrl = location.href;
  let videoId = args.id;

  // Auto-detect from current page
  if (!videoId) {
    const match = currentUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (match) videoId = match[1];
  }
  if (!videoId) return {error: 'No video ID', hint: 'Provide a video ID or navigate to a YouTube video page'};

  const onVideoPage = currentUrl.includes('watch?v=' + videoId);

  // If we're on the video page, use pre-rendered data
  if (onVideoPage && window.ytInitialPlayerResponse && window.ytInitialData) {
    const p = window.ytInitialPlayerResponse;
    const d = window.ytInitialData;

    const vd = p.videoDetails || {};
    const mf = p.microformat?.playerMicroformatRenderer || {};

    // Extract engagement data from ytInitialData
    const results = d.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
    const primary = results.find(i => i.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;

    let likeCount = '';
    const menuRenderer = primary?.videoActions?.menuRenderer;
    if (menuRenderer?.topLevelButtons) {
      for (const btn of menuRenderer.topLevelButtons) {
        const seg = btn.segmentedLikeDislikeButtonViewModel;
        if (seg) {
          likeCount = seg.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel?.title || '';
        }
      }
    }

    // Channel info
    const secondary = results.find(i => i.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer;
    const owner = secondary?.owner?.videoOwnerRenderer;

    // Comment count from section
    const commentSection = results.find(i => i.itemSectionRenderer?.targetId === 'comments-section');
    const commentToken = commentSection?.itemSectionRenderer?.contents?.[0]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;

    // Chapters
    const chapters = [];
    const chapterPanel = d.engagementPanels?.find(p => p.engagementPanelSectionListRenderer?.panelIdentifier === 'engagement-panel-macro-markers-description-chapters');

    return {
      videoId: vd.videoId,
      title: vd.title,
      channel: vd.author,
      channelId: vd.channelId,
      channelUrl: owner?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ? 'https://www.youtube.com' + owner.navigationEndpoint.browseEndpoint.canonicalBaseUrl : '',
      subscriberCount: owner?.subscriberCountText?.simpleText || '',
      description: (vd.shortDescription || '').substring(0, 1000),
      duration: parseInt(vd.lengthSeconds) || 0,
      durationFormatted: (() => {
        const s = parseInt(vd.lengthSeconds) || 0;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return h > 0 ? h + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0') : m + ':' + String(sec).padStart(2,'0');
      })(),
      viewCount: parseInt(vd.viewCount) || 0,
      viewCountFormatted: primary?.viewCount?.videoViewCountRenderer?.viewCount?.simpleText || '',
      likes: likeCount,
      publishDate: mf.publishDate || primary?.dateText?.simpleText || '',
      category: mf.category || '',
      isLive: vd.isLiveContent || false,
      keywords: (vd.keywords || []).slice(0, 20),
      captionLanguages: (p.captions?.playerCaptionsTracklistRenderer?.captionTracks || []).map(t => ({lang: t.languageCode, name: t.name?.simpleText})),
      url: 'https://www.youtube.com/watch?v=' + vd.videoId,
      _commentContinuationToken: commentToken || null
    };
  }

  // If not on the video page, use innertube next API for basic info
  const cfg = window.ytcfg?.data_ || {};
  const apiKey = cfg.INNERTUBE_API_KEY;
  const context = cfg.INNERTUBE_CONTEXT;
  if (!apiKey || !context) return {error: 'YouTube config not found', hint: 'Make sure you are on youtube.com'};

  const resp = await fetch('/youtubei/v1/next?key=' + apiKey + '&prettyPrint=false', {
    method: 'POST',
    credentials: 'include',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({context, videoId})
  });

  if (!resp.ok) return {error: 'API returned HTTP ' + resp.status};
  const data = await resp.json();

  const results = data.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
  const primary = results.find(i => i.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;
  const secondary = results.find(i => i.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer;
  const owner = secondary?.owner?.videoOwnerRenderer;

  let likeCount = '';
  const menuRenderer = primary?.videoActions?.menuRenderer;
  if (menuRenderer?.topLevelButtons) {
    for (const btn of menuRenderer.topLevelButtons) {
      const seg = btn.segmentedLikeDislikeButtonViewModel;
      if (seg) {
        likeCount = seg.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel?.title || '';
      }
    }
  }

  return {
    videoId,
    title: primary?.title?.runs?.[0]?.text || '',
    channel: owner?.title?.runs?.[0]?.text || '',
    channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId || '',
    subscriberCount: owner?.subscriberCountText?.simpleText || '',
    viewCountFormatted: primary?.viewCount?.videoViewCountRenderer?.viewCount?.simpleText || '',
    likes: likeCount,
    publishDate: primary?.dateText?.simpleText || '',
    url: 'https://www.youtube.com/watch?v=' + videoId
  };
}
