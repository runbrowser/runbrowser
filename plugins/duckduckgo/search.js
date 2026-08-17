/* @meta
{
  "name": "duckduckgo/search",
  "description": "DuckDuckGo search (HTML lite, no JS needed)",
  "domain": "duckduckgo.com",
  "args": {
    "query": {"required": true, "description": "Search query"}
  },
  "readOnly": true,
  "example": "bb-browser site duckduckgo/search \"bb-browser CLI\""
}
*/

async function(args) {
  if (!args.query) return {error: 'Missing argument: query', hint: 'Provide a search query string'};

  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(args.query);
  const resp = await fetch(url);
  if (!resp.ok) return {error: 'HTTP ' + resp.status};

  const html = await resp.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const items = doc.querySelectorAll('.result');
  const results = [];
  items.forEach(el => {
    const anchor = el.querySelector('.result__a');
    if (!anchor) return;
    const title = anchor.textContent.trim();
    let href = anchor.getAttribute('href') || '';
    // DuckDuckGo lite wraps URLs in a redirect; extract the actual URL if present
    const udMatch = href.match(/[?&]uddg=([^&]+)/);
    if (udMatch) href = decodeURIComponent(udMatch[1]);
    const snippetEl = el.querySelector('.result__snippet');
    const snippet = snippetEl ? snippetEl.textContent.trim() : '';
    results.push({title, url: href, snippet});
  });

  return {query: args.query, count: results.length, results};
}
