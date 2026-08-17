/* @meta
{
  "name": "genius/search",
  "description": "Genius 歌曲/歌词搜索",
  "domain": "genius.com",
  "args": {
    "query": { "type": "string", "required": true, "description": "搜索关键词" }
  },
  "readOnly": true,
  "example": "bb-browser site genius/search \"bohemian rhapsody\""
}
*/

async function(args) {
  const q = encodeURIComponent(args.query);
  const resp = await fetch(`https://genius.com/api/search/multi?q=${q}`);
  if (!resp.ok) return { error: 'HTTP ' + resp.status };
  const data = await resp.json();

  const sections = data?.response?.sections || [];
  const songSection = sections.find(s => s.type === 'song') || sections[0];
  if (!songSection || !songSection.hits || songSection.hits.length === 0) {
    return { query: args.query, count: 0, results: [] };
  }

  const results = songSection.hits.map(hit => {
    const r = hit.result;
    return {
      title: r.title,
      artist: r.primary_artist?.name,
      url: r.url,
      image: r.song_art_image_url,
      pageviews: r.stats?.pageviews || null
    };
  });

  return { query: args.query, count: results.length, results };
}
