/* @meta
{
  "name": "xueqiu/watchlist",
  "description": "获取雪球自选股列表",
  "domain": "xueqiu.com",
  "args": {
    "category": {"required": false, "description": "分类：1=自选(默认) 2=持仓 3=关注"}
  },
  "readOnly": true,
  "example": "bb-browser site xueqiu/watchlist"
}
*/

async function(args) {
  var category = parseInt(args.category) || 1;
  var resp = await fetch('https://stock.xueqiu.com/v5/stock/portfolio/stock/list.json?size=100&category=' + category + '&pid=-1', {credentials: 'include'});
  if (!resp.ok) return {error: 'HTTP ' + resp.status, hint: 'Not logged in?'};
  var d = await resp.json();
  if (!d.data || !d.data.stocks) return {error: '获取失败，可能未登录', raw: d};

  var items = d.data.stocks.map(function(s) {
    return {
      symbol: s.symbol,
      name: s.name,
      price: s.current,
      change: s.chg,
      changePercent: s.percent != null ? s.percent.toFixed(2) + '%' : null,
      volume: s.volume,
      url: 'https://xueqiu.com/S/' + s.symbol
    };
  });

  var labels = {1: '自选股', 2: '持仓', 3: '关注'};
  return {category: labels[category] || category, count: items.length, items: items};
}
