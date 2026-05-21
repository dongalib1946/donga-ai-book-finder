const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_VERSION || 'v25.0';
const DEFAULT_LIMIT = Math.min(12, Math.max(1, Number.parseInt(process.env.INSTAGRAM_FEED_LIMIT || '6', 10) || 6));
const TIMEOUT_MS = Math.max(2000, Number.parseInt(process.env.INSTAGRAM_FETCH_TIMEOUT_MS || '8000', 10) || 8000);

function json(statusCode, body, cacheControl = 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600') {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
    body: JSON.stringify(body),
  };
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const permalink = cleanText(item.permalink);
  if (!permalink) return null;
  const mediaType = cleanText(item.media_type);
  return {
    id: cleanText(item.id),
    caption: cleanText(item.caption),
    mediaType,
    mediaUrl: cleanText(item.media_url),
    thumbnailUrl: cleanText(item.thumbnail_url || item.media_url),
    permalink,
    timestamp: cleanText(item.timestamp),
    username: cleanText(item.username),
  };
}

async function fetchInstagramFeed(limit) {
  const userId = cleanText(process.env.INSTAGRAM_USER_ID);
  const accessToken = cleanText(process.env.INSTAGRAM_ACCESS_TOKEN);
  if (!userId || !accessToken) {
    return { configured: false, items: [] };
  }

  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(userId)}/media`);
  url.searchParams.set('fields', 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('access_token', accessToken);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload && payload.error && payload.error.message
        ? payload.error.message
        : `Instagram API error: ${response.status}`;
      const error = new Error(message);
      error.statusCode = response.status;
      throw error;
    }
    const items = (Array.isArray(payload.data) ? payload.data : [])
      .map(normalizeItem)
      .filter(Boolean);
    return { configured: true, items };
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {}, 'no-store');
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' }, 'no-store');

  try {
    const url = new URL(event.rawUrl || `http://localhost${event.path || '/.netlify/functions/instagram-feed'}`);
    const limit = Math.min(12, Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
    const result = await fetchInstagramFeed(limit);
    return json(200, {
      version: 'instagram-feed-v1',
      updatedAt: new Date().toISOString(),
      source: result.configured ? 'instagram-api' : 'not-configured',
      configured: result.configured,
      items: result.items,
    });
  } catch (error) {
    return json(error.statusCode || 502, {
      version: 'instagram-feed-v1',
      source: 'instagram-api',
      error: error.message || 'Instagram feed could not be loaded.',
      items: [],
    }, 'no-store');
  }
};
