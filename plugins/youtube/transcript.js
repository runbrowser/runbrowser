/* @meta
{
  "name": "youtube/transcript",
  "description": "Get video transcript/captions (must be on the video page)",
  "domain": "www.youtube.com",
  "args": {
    "lang": {"required": false, "description": "Language code (default: first available, e.g. 'en', 'ja')"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site youtube/transcript"
}
*/

async function(args) {
  const currentUrl = location.href;
  const match = currentUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (!match) return {error: 'Not on a video page', hint: 'Navigate to a YouTube video page first (youtube.com/watch?v=...)'};

  const videoId = match[1];

  // Get available tracks from ytInitialPlayerResponse
  const playerResp = window.ytInitialPlayerResponse;
  const trackList = playerResp?.captions?.playerCaptionsTracklistRenderer;
  const tracks = trackList?.captionTracks || [];
  const availableTracks = tracks.map(t => ({lang: t.languageCode, name: t.name?.simpleText, kind: t.kind}));

  // Find the transcript engagement panel
  const panel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
  if (!panel) return {
    error: 'No transcript panel found',
    hint: 'This video may not have captions/subtitles available.',
    videoId,
    availableTracks
  };

  // If a specific language is requested, try to select it
  if (args.lang && tracks.length > 1) {
    const langTrack = tracks.find(t => t.languageCode === args.lang);
    if (!langTrack) return {
      error: 'Language "' + args.lang + '" not found',
      hint: 'Available: ' + availableTracks.map(t => t.lang + ' (' + (t.name || t.kind || '') + ')').join(', '),
      videoId
    };
  }

  // Expand the transcript panel if hidden
  const wasHidden = panel.getAttribute('visibility') !== 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
  if (wasHidden) {
    panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
    await new Promise(r => setTimeout(r, 2000));
  }

  // If language selection needed, click the language dropdown
  if (args.lang && tracks.length > 1) {
    const menuBtn = panel.querySelector('yt-sort-filter-sub-menu-renderer button, #menu button');
    if (menuBtn) {
      menuBtn.click();
      await new Promise(r => setTimeout(r, 500));
      const menuItems = panel.querySelectorAll('tp-yt-paper-listbox tp-yt-paper-item, yt-dropdown-menu tp-yt-paper-item');
      for (const item of menuItems) {
        const txt = item.textContent?.trim().toLowerCase();
        const trackMatch = tracks.find(t => t.languageCode === args.lang);
        if (trackMatch && txt.includes(trackMatch.name?.simpleText?.toLowerCase() || args.lang)) {
          item.click();
          await new Promise(r => setTimeout(r, 2000));
          break;
        }
      }
    }
  }

  // Extract transcript segments from DOM
  const segmentEls = panel.querySelectorAll('ytd-transcript-segment-renderer');

  if (!segmentEls.length) {
    // Restore panel state
    if (wasHidden) panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
    return {
      error: 'No transcript segments loaded',
      hint: 'The transcript panel is present but empty. Try refreshing the page.',
      videoId,
      availableTracks
    };
  }

  const segments = Array.from(segmentEls).map(seg => {
    const timeText = seg.querySelector('.segment-timestamp')?.textContent?.trim() || '';
    const text = seg.querySelector('.segment-text')?.textContent?.trim() || '';

    // Parse time string (e.g. "1:23" or "1:02:34") to seconds
    const parts = timeText.split(':').map(Number);
    let startSec = 0;
    if (parts.length === 3) startSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) startSec = parts[0] * 60 + parts[1];
    else if (parts.length === 1) startSec = parts[0];

    return {
      start: startSec,
      startFormatted: timeText,
      text
    };
  }).filter(s => s.text);

  // Restore panel state if we opened it
  if (wasHidden) {
    panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
  }

  // Determine language from available info
  let language = tracks[0]?.languageCode || 'unknown';
  let languageName = tracks[0]?.name?.simpleText || '';
  let kind = tracks[0]?.kind || 'manual';
  if (args.lang) {
    const langTrack = tracks.find(t => t.languageCode === args.lang);
    if (langTrack) {
      language = langTrack.languageCode;
      languageName = langTrack.name?.simpleText || '';
      kind = langTrack.kind || 'manual';
    }
  }

  // Build full text version
  const fullText = segments.map(s => s.text).join(' ');

  // Estimate total duration from last segment
  const lastSeg = segments[segments.length - 1];
  const totalDuration = lastSeg ? lastSeg.start + 10 : 0;

  return {
    videoId,
    language,
    languageName,
    kind,
    segmentCount: segments.length,
    totalDuration,
    availableTracks,
    segments,
    fullText: fullText.substring(0, 5000)
  };
}
