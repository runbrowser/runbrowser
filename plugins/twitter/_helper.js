// Shared Twitter adapter helpers.
// Auto-loaded by bb-browser site runtime before each twitter/* adapter.

function _twitterGetWebpackRequire() {
  let __webpack_require__;
  window.webpackChunk_twitter_responsive_web.push(
    [['__bb_h_' + Date.now()], {}, (req) => { __webpack_require__ = req; }]
  );
  return __webpack_require__;
}

function findGraphQLQueryId(operationName, fallbackQueryId) {
  try {
    const req = _twitterGetWebpackRequire();
    const op = operationName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp('queryId:\\s*"([^"]+)"\\s*,\\s*operationName:\\s*"' + op + '"'),
      new RegExp('operationName:\\s*"' + op + '"\\s*,\\s*queryId:\\s*"([^"]+)"')
    ];
    for (const id of Object.keys(req.m)) {
      try {
        const src = req.m[id].toString();
        if (!src.includes(operationName)) continue;
        for (const pattern of patterns) {
          const m = src.match(pattern);
          if (m) return m[1];
        }
      } catch {}
    }
  } catch {}
  return fallbackQueryId;
}

async function findTransactionIdGenerator() {
  try {
    const req = _twitterGetWebpackRequire();
    for (const id of Object.keys(req.m)) {
      try {
        const src = req.m[id].toString();
        if (!src.includes('x-client-transaction-id') || !src.includes('rweb_client_transaction_id_enabled')) continue;
        const mod = req(id);
        for (const fn of Object.values(mod)) {
          if (typeof fn !== 'function') continue;
          try {
            const sample = await fn('x.com', '/i/api/graphql/test/Op', 'GET');
            if (typeof sample !== 'string' || sample.length < 40) continue;
            try { if (atob(sample).startsWith('e:')) continue; } catch {}
            return fn;
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return null;
}
