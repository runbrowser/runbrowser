/* @meta
{
  "name": "ctrip/search",
  "description": "携程旅行搜索 - 搜索目的地景点信息",
  "domain": "www.ctrip.com",
  "args": {
    "query": {"required": true, "description": "搜索关键词，如城市名或景点名"}
  },
  "readOnly": true,
  "example": "bb-browser site ctrip/search \"三亚\""
}
*/

async function(args) {
  const query = args.query;
  if (!query) return {error: 'query is required'};

  // Strategy 1: Try the hotel/destination suggestion API (works in-browser with session)
  try {
    const suggestUrl = 'https://m.ctrip.com/restapi/h5api/searchapp/search?action=onekeyali&keyword=' + encodeURIComponent(query);
    const suggestResp = await fetch(suggestUrl, {credentials: 'include'});
    if (suggestResp.ok) {
      const suggestData = await suggestResp.json();
      if (suggestData && (suggestData.data || suggestData.result)) {
        const raw = suggestData.data || suggestData.result || suggestData;
        return {query: query, source: 'suggest_api', data: raw};
      }
    }
  } catch(e) { /* fall through */ }

  // Strategy 2: Try the global search suggestion API
  try {
    const globalUrl = 'https://www.ctrip.com/m/i/webapp/search-result/?query=' + encodeURIComponent(query);
    const globalResp = await fetch(globalUrl, {credentials: 'include'});
    if (globalResp.ok) {
      const text = await globalResp.text();
      if (text.startsWith('{') || text.startsWith('[')) {
        return {query: query, source: 'global_api', data: JSON.parse(text)};
      }
    }
  } catch(e) { /* fall through */ }

  // Strategy 3: Parse the hotel search results page
  try {
    const hotelUrl = 'https://hotels.ctrip.com/hotels/list?keyword=' + encodeURIComponent(query);
    const hotelResp = await fetch(hotelUrl, {credentials: 'include'});
    if (hotelResp.ok) {
      const html = await hotelResp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Try to extract embedded JSON data (Ctrip often puts initialState in scripts)
      const scripts = doc.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        // Look for hotel list data in window.__INITIAL_STATE__ or similar
        const stateMatch = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*(?:window\.|<\/script>|$)/);
        if (stateMatch) {
          try {
            const state = JSON.parse(stateMatch[1]);
            const hotelList = state.hotelList || state.list || state.hotels;
            if (hotelList && Array.isArray(hotelList)) {
              return {
                query: query,
                source: 'hotel_initial_state',
                count: hotelList.length,
                hotels: hotelList.slice(0, 15).map(h => ({
                  name: h.hotelName || h.name,
                  star: h.star,
                  score: h.score,
                  commentCount: h.commentCount,
                  price: h.price || h.minPrice,
                  address: h.address,
                  url: h.url || h.detailUrl
                }))
              };
            }
          } catch(e) { /* JSON parse failed, continue */ }
        }
      }

      // Fallback: parse hotel cards from DOM
      const hotelCards = doc.querySelectorAll('[class*="hotel-card"], [class*="hotelList"], li[class*="list-item"], div[class*="hotel_new_list"]');
      if (hotelCards.length > 0) {
        const hotels = [];
        hotelCards.forEach(card => {
          const nameEl = card.querySelector('a[class*="name"], h2, [class*="hotel_name"]');
          const scoreEl = card.querySelector('[class*="score"], [class*="rating"]');
          const priceEl = card.querySelector('[class*="price"]');
          const addrEl = card.querySelector('[class*="address"], [class*="location"]');
          if (nameEl) {
            hotels.push({
              name: (nameEl.textContent || '').trim(),
              score: scoreEl ? (scoreEl.textContent || '').trim() : '',
              price: priceEl ? (priceEl.textContent || '').trim() : '',
              address: addrEl ? (addrEl.textContent || '').trim() : ''
            });
          }
        });
        if (hotels.length > 0) {
          return {query: query, source: 'hotel_html', count: hotels.length, hotels: hotels.slice(0, 15)};
        }
      }

      // Last resort: extract any text content from the results area
      const resultArea = doc.querySelector('#hotel_list, [class*="list-body"], [class*="result"], .searchresult');
      if (resultArea) {
        return {
          query: query,
          source: 'hotel_text',
          text: (resultArea.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 2000)
        };
      }
    }
  } catch(e) { /* fall through */ }

  // Strategy 4: Try the travel guide / destination page via you.ctrip.com
  try {
    const guideUrl = 'https://you.ctrip.com/SearchSite/Default/Destination?keyword=' + encodeURIComponent(query);
    const guideResp = await fetch(guideUrl, {credentials: 'include'});
    if (guideResp.ok) {
      const html = await guideResp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const items = doc.querySelectorAll('[class*="result"], [class*="dest-item"], li, .list_mod_item');
      const results = [];
      items.forEach(el => {
        const linkEl = el.querySelector('a[href]');
        const nameEl = el.querySelector('h2, h3, [class*="name"], [class*="title"]');
        if (linkEl && nameEl) {
          results.push({
            name: (nameEl.textContent || '').trim(),
            url: linkEl.getAttribute('href') || ''
          });
        }
      });
      if (results.length > 0) {
        return {query: query, source: 'destination_search', count: results.length, results: results.slice(0, 15)};
      }
    }
  } catch(e) { /* fall through */ }

  // Strategy 5: Use site-wide search on ctrip.com
  try {
    const searchUrl = 'https://www.ctrip.com/global-search/result?keyword=' + encodeURIComponent(query);
    const searchResp = await fetch(searchUrl, {credentials: 'include'});
    if (searchResp.ok) {
      const html = await searchResp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const allLinks = doc.querySelectorAll('a[href]');
      const results = [];
      allLinks.forEach(a => {
        const text = (a.textContent || '').trim();
        const href = a.getAttribute('href') || '';
        if (text.length > 4 && text.length < 200 && href.includes('ctrip.com') && !href.includes('javascript:')) {
          results.push({title: text, url: href});
        }
      });
      if (results.length > 0) {
        // deduplicate by title
        const seen = new Set();
        const unique = results.filter(r => {
          if (seen.has(r.title)) return false;
          seen.add(r.title);
          return true;
        });
        return {query: query, source: 'global_search', count: unique.length, results: unique.slice(0, 20)};
      }
    }
  } catch(e) { /* fall through */ }

  return {
    query: query,
    error: 'No results found. Ctrip may require an active browser session on www.ctrip.com.',
    hint: 'Open www.ctrip.com in bb-browser first, then retry.'
  };
}
