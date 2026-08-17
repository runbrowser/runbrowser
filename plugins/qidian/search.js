/* @meta
{
  "name": "qidian/search",
  "description": "起点中文网小说搜索",
  "domain": "www.qidian.com",
  "args": {
    "query": {"required": true, "description": "Search keyword (e.g. 仙侠, 系统流)"},
    "page": {"required": false, "description": "Page number (default 1)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site qidian/search \"仙侠\""
}
*/

async function(args) {
  if (!args.query) return {error: 'Missing argument: query'};
  const page = parseInt(args.page) || 1;
  const kw = encodeURIComponent(args.query);

  const url = 'https://www.qidian.com/so/' + kw + '.html' + (page > 1 ? '?page=' + page : '');
  const resp = await fetch(url, {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Make sure a qidian.com tab is open'};

  const html = await resp.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Try embedded JSON data first
  let jsonData = null;
  for (const s of doc.querySelectorAll('script')) {
    const text = s.textContent || '';
    for (const pat of [
      /g_search_data\s*=\s*(\{[\s\S]*?\});/,
      /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/,
      /"bookList"\s*:\s*(\[[\s\S]*?\])\s*[,}]/
    ]) {
      const m = text.match(pat);
      if (m) { try { jsonData = JSON.parse(m[1]); } catch(e) {} }
      if (jsonData) break;
    }
    if (jsonData) break;
  }

  if (jsonData) {
    const bookList = jsonData.bookList || jsonData.books || jsonData.data?.bookList || [];
    if (Array.isArray(bookList) && bookList.length > 0) {
      const books = bookList.map((b, i) => ({
        rank: i + 1,
        id: b.bookId || b.bid || b.id,
        title: b.bookName || b.bName || b.title || b.name,
        author: b.authorName || b.author || b.aName,
        category: b.catName || b.category || b.cat,
        description: (b.desc || b.description || b.intro || '').substring(0, 300),
        wordCount: b.totalWordCount || b.wordCount || b.cnt || null,
        status: b.isFinish === 1 ? '完结' : b.isFinish === 0 ? '连载' : b.state || null,
        cover: b.bookCoverUrl || b.cover || null,
        url: 'https://book.qidian.com/info/' + (b.bookId || b.bid || b.id) + '/'
      }));
      return {query: args.query, page, count: books.length, books};
    }
  }

  // DOM parsing: Qidian uses <li class="res-book-item"> for each result
  const resultItems = doc.querySelectorAll(
    '.res-book-item, .book-result-item, li[data-bid], ' +
    '.search-result-page .book-img-text li'
  );

  if (resultItems.length > 0) {
    const seen = new Set();
    const books = [];
    resultItems.forEach((el) => {
      // Title: first meaningful link
      const titleEl = el.querySelector('h2 a, h3 a, h4 a, [class*="title"] a');
      const title = titleEl ? titleEl.textContent.trim() : '';
      if (!title) return;

      // Book ID from link
      const href = titleEl ? (titleEl.getAttribute('href') || '') : '';
      const idMatch = href.match(/\/(?:info|book)\/(\d+)/);
      const bookId = idMatch ? idMatch[1] : (el.getAttribute('data-bid') || null);
      if (bookId && seen.has(bookId)) return;
      if (bookId) seen.add(bookId);

      // Parse the full text content to extract structured fields
      // Typical format: "Title Author |Category|Status Description... 最新更新 Chapter·Time WordCount"
      const fullText = (el.textContent || '').replace(/\s+/g, ' ').trim();

      // Extract "author |category|status" metadata
      let author = '';
      let category = '';
      let status = null;
      const metaMatch = fullText.match(/([^\s|]{2,})\s*\|([^|]+)\|(\S+)/);
      if (metaMatch) {
        author = metaMatch[1].trim();
        category = metaMatch[2].trim();
        const st = metaMatch[3].trim();
        if (st === '连载' || st === '完结') status = st;
      }

      // Extract description: text between "status" and "最新更新"
      let description = '';
      const descMatch = fullText.match(/\|(连载|完结)\s+(.+?)(?:\s+最新更新|$)/);
      if (descMatch && descMatch[2]) {
        description = descMatch[2].trim().substring(0, 300);
      }

      // Word count: "XX.XX万总字数" or "XX万字"
      let wordCount = null;
      const wcMatch = fullText.match(/([\d,.]+)\s*万(?:总字数|字)/);
      if (wcMatch) wordCount = wcMatch[1] + '万字';

      // Last update
      let lastUpdate = null;
      const updateMatch = fullText.match(/最新更新\s*(.+?)(?:\s+[\d,.]+万|$)/);
      if (updateMatch) lastUpdate = updateMatch[1].trim();

      // Cover image
      const imgEl = el.querySelector('img[src*="bookcover"], img[src*="qdbimg"], img[data-src*="bookcover"]');
      let cover = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src')) : null;
      if (cover && cover.startsWith('//')) cover = 'https:' + cover;

      const bookUrl = bookId
        ? 'https://book.qidian.com/info/' + bookId + '/'
        : (href.startsWith('http') ? href : 'https://www.qidian.com' + href);

      books.push({
        rank: books.length + 1, id: bookId, title, author, category,
        description, wordCount, status, lastUpdate, cover, url: bookUrl
      });
    });

    if (books.length > 0) {
      const pageInfo = doc.querySelector('[class*="pagination"], [class*="page"]');
      const hasMore = pageInfo ? pageInfo.textContent.includes('下一页') : false;
      return {query: args.query, page, count: books.length, hasMore, books};
    }
  }

  // Last resort: collect unique book links
  const allBookLinks = doc.querySelectorAll('a[href*="book.qidian.com/info/"], a[href*="/info/"], a[href*="/book/"]');
  if (allBookLinks.length > 0) {
    const seen = new Set();
    const books = [];
    allBookLinks.forEach((a) => {
      const href = a.getAttribute('href') || '';
      const idMatch = href.match(/\/(?:info|book)\/(\d+)/);
      const bookId = idMatch ? idMatch[1] : null;
      if (!bookId || seen.has(bookId)) return;
      seen.add(bookId);
      const title = a.textContent.trim();
      if (!title || title.length > 100) return;
      books.push({
        rank: books.length + 1, id: bookId, title,
        url: 'https://book.qidian.com/info/' + bookId + '/'
      });
    });
    if (books.length > 0) {
      return {query: args.query, page, count: books.length, books, note: 'Partial results'};
    }
  }

  return {
    error: 'No results found',
    hint: 'Navigate to www.qidian.com first. The page may require login or the HTML structure has changed.',
    debug: { htmlLength: html.length, title: doc.title || '' }
  };
}
