const { connectNewsSnapshot } = require('./library-news-snapshot.js');
const { refreshLibraryNewsSnapshot } = require('./refresh-library-news-core.js');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-refresh-token',
    },
    body: JSON.stringify(body),
  };
}

function headerValue(headers, name) {
  const lowerName = name.toLowerCase();
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === lowerName);
  return entry ? String(entry[1] || '') : '';
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const url = new URL(event.rawUrl || `http://localhost${event.path || '/.netlify/functions/refresh-library-news-now'}`);
  const requiredSecret = String(process.env.NEWS_REFRESH_SECRET || '');
  const suppliedSecret = url.searchParams.get('token') || headerValue(event.headers, 'x-refresh-token');
  if (requiredSecret && suppliedSecret !== requiredSecret) {
    return json(401, { error: 'Unauthorized' });
  }

  try {
    connectNewsSnapshot(event);
    const result = await refreshLibraryNewsSnapshot();
    console.log('[Library news manual refresh]', JSON.stringify(result));
    return json(200, { ...result, manual: true });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
};
