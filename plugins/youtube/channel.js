/* @meta
{
  "name": "youtube/channel",
  "description": "Get YouTube channel info and recent videos",
  "domain": "www.youtube.com",
  "args": {
    "id": {"required": false, "description": "Channel ID (UCxxxx) or handle (@name). Defaults to current page channel."},
    "max": {"required": false, "description": "Max recent videos to return (default: 10)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site youtube/channel '@programmingwithmosh'"
}
*/

async function(args) {
  const cfg = window.ytcfg?.data_ || {};
  const apiKey = cfg.INNERTUBE_API_KEY;
  const context = cfg.INNERTUBE_CONTEXT;
  if (!apiKey || !context) return {error: 'YouTube config not found', hint: 'Make sure you are on youtube.com'};

  const max = Math.min(parseInt(args.max) || 10, 30);
  let browseId = args.id || '';

  // Detect from current page
  if (!browseId) {
    const match = location.href.match(/youtube\.com\/(channel\/|c\/|@)([^/?]+)/);
    if (match) {
      browseId = match[1] === 'channel/' ? match[2] : '@' + match[2].replace(/^@/, '');
    }
  }
  if (!browseId) return {error: 'No channel ID or handle', hint: 'Provide a channel ID (UCxxxx) or handle (@name)'};

  // If it's a handle, need to resolve it
  let resolvedBrowseId = browseId;
  if (browseId.startsWith('@')) {
    const resolveResp = await fetch('/youtubei/v1/navigation/resolve_url?key=' + apiKey + '&prettyPrint=false', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({context, url: 'https://www.youtube.com/' + browseId})
    });
    if (resolveResp.ok) {
      const resolveData = await resolveResp.json();
      resolvedBrowseId = resolveData.endpoint?.browseEndpoint?.browseId || browseId;
    }
  }

  // Fetch channel data
  const resp = await fetch('/youtubei/v1/browse?key=' + apiKey + '&prettyPrint=false', {
    method: 'POST',
    credentials: 'include',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({context, browseId: resolvedBrowseId})
  });

  if (!resp.ok) return {error: 'Channel API returned HTTP ' + resp.status, hint: resp.status === 404 ? 'Channel not found' : 'API error'};
  const data = await resp.json();

  // Channel metadata
  const metadata = data.metadata?.channelMetadataRenderer || {};
  const header = data.header?.pageHeaderRenderer || data.header?.c4TabbedHeaderRenderer || {};

  // Try to get subscriber count from header
  let subscriberCount = '';
  if (header.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows) {
    const rows = header.content.pageHeaderViewModel.metadata.contentMetadataViewModel.metadataRows;
    for (const row of rows) {
      for (const part of (row.metadataParts || [])) {
        const text = part.text?.content || '';
        if (text.includes('subscriber')) subscriberCount = text;
      }
    }
  }

  // Get tabs to find Videos tab
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const tabNames = tabs.map(t => t.tabRenderer?.title || t.expandableTabRenderer?.title).filter(Boolean);

  // Extract recent videos from the Home or Videos tab
  let recentVideos = [];

  // Try Home tab first
  const homeTab = tabs.find(t => t.tabRenderer?.selected);
  if (homeTab) {
    const sections = homeTab.tabRenderer?.content?.sectionListRenderer?.contents || [];
    for (const section of sections) {
      const shelfItems = section.itemSectionRenderer?.contents || [];
      for (const shelf of shelfItems) {
        const items = shelf.shelfRenderer?.content?.horizontalListRenderer?.items || [];
        for (const item of items) {
          const lvm = item.lockupViewModel;
          if (lvm && lvm.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && recentVideos.length < max) {
            const meta = lvm.metadata?.lockupMetadataViewModel;
            const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
            let viewsAndTime = (rows[0]?.metadataParts || []).map(p => p.text?.content).filter(Boolean).join(' | ');
            const overlays = lvm.contentImage?.thumbnailViewModel?.overlays || [];
            let duration = '';
            for (const ov of overlays) {
              for (const b of (ov.thumbnailBottomOverlayViewModel?.badges || [])) {
                if (b.thumbnailBadgeViewModel?.text) duration = b.thumbnailBadgeViewModel.text;
              }
            }
            recentVideos.push({
              videoId: lvm.contentId,
              title: meta?.title?.content || '',
              duration,
              viewsAndTime,
              url: 'https://www.youtube.com/watch?v=' + lvm.contentId
            });
          }
          // Also handle gridVideoRenderer (older format)
          if (item.gridVideoRenderer && recentVideos.length < max) {
            const v = item.gridVideoRenderer;
            recentVideos.push({
              videoId: v.videoId,
              title: v.title?.runs?.[0]?.text || v.title?.simpleText || '',
              duration: v.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || '',
              viewsAndTime: (v.shortViewCountText?.simpleText || '') + (v.publishedTimeText?.simpleText ? ' | ' + v.publishedTimeText.simpleText : ''),
              url: 'https://www.youtube.com/watch?v=' + v.videoId
            });
          }
        }
      }
    }
  }

  return {
    channelId: metadata.externalId || resolvedBrowseId,
    name: metadata.title || '',
    handle: metadata.vanityChannelUrl?.split('/').pop() || '',
    description: (metadata.description || '').substring(0, 500),
    subscriberCount,
    channelUrl: metadata.channelUrl || 'https://www.youtube.com/channel/' + resolvedBrowseId,
    keywords: metadata.keywords || '',
    isFamilySafe: metadata.isFamilySafe,
    tabs: tabNames,
    recentVideoCount: recentVideos.length,
    recentVideos
  };
}
