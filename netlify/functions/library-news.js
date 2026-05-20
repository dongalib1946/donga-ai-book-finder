const { fetchCommunityNotices } = require('./recommend-books.js');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'cdn-cache-control': 'no-store',
      'netlify-cdn-cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  try {
    const url = new URL(event.rawUrl || `http://localhost${event.path || '/.netlify/functions/library-news'}`);
    const limit = Math.min(10, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '5', 10) || 5));
    const notices = await fetchCommunityNotices(limit, { fresh: true });
    return json(200, {
      version: 'library-news-v1',
      updatedAt: new Date().toISOString(),
      notices,
    });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.message || '도서관 소식을 불러오지 못했습니다.' });
  }
};
