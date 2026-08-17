/* @meta
{
  "name": "zhihu/question",
  "description": "Get a Zhihu question and its top answers",
  "domain": "www.zhihu.com",
  "args": {
    "id": {"required": true, "description": "Question ID (numeric)"},
    "count": {"required": false, "description": "Number of answers to fetch (default: 5, max: 20)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bb-browser site zhihu/question 34816524"
}
*/

async function(args) {
  if (!args.id) return {error: 'Missing argument: id'};
  const qid = args.id;
  const count = Math.min(parseInt(args.count) || 5, 20);

  // Fetch question detail and answers in parallel
  const [qResp, aResp] = await Promise.all([
    fetch('https://www.zhihu.com/api/v4/questions/' + qid + '?include=data[*].detail,excerpt,answer_count,follower_count,visit_count,comment_count,topics', {credentials: 'include'}),
    fetch('https://www.zhihu.com/api/v4/questions/' + qid + '/answers?limit=' + count + '&offset=0&sort_by=default&include=data[*].content,voteup_count,comment_count,author', {credentials: 'include'})
  ]);

  if (!qResp.ok) return {error: 'HTTP ' + qResp.status + ' fetching question', hint: qResp.status === 404 ? 'Question not found' : 'Not logged in?'};
  if (!aResp.ok) return {error: 'HTTP ' + aResp.status + ' fetching answers', hint: 'Not logged in?'};

  const q = await qResp.json();
  const aData = await aResp.json();

  // Strip HTML tags helper
  const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

  const answers = (aData.data || []).map((a, i) => ({
    rank: i + 1,
    id: a.id,
    author: a.author?.name || 'anonymous',
    author_headline: a.author?.headline || '',
    voteup_count: a.voteup_count,
    comment_count: a.comment_count,
    content: strip(a.content).substring(0, 800),
    created_time: a.created_time,
    updated_time: a.updated_time
  }));

  return {
    id: q.id,
    title: q.title,
    url: 'https://www.zhihu.com/question/' + qid,
    detail: strip(q.detail) || '',
    excerpt: q.excerpt || '',
    answer_count: q.answer_count,
    follower_count: q.follower_count,
    visit_count: q.visit_count,
    comment_count: q.comment_count,
    topics: (q.topics || []).map(t => t.name),
    answers_total: aData.paging?.totals || answers.length,
    answers
  };
}
