import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fetchCommunityNoticeResult } = require('./recommend-books.js');
const { writeNewsSnapshot } = require('./library-news-snapshot.js');

const SNAPSHOT_LIMIT = Math.min(10, Math.max(1, Number.parseInt(process.env.NEWS_SNAPSHOT_LIMIT || '5', 10) || 5));
const SNAPSHOT_FETCH_TIMEOUT_MS = Math.max(3000, Number.parseInt(process.env.NEWS_SNAPSHOT_FETCH_TIMEOUT_MS || '10000', 10) || 10000);

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default async function refreshLibraryNews() {
  const startedAt = Date.now();
  const result = await fetchCommunityNoticeResult(SNAPSHOT_LIMIT, {
    fresh: true,
    fastFallback: false,
    timeoutMs: SNAPSHOT_FETCH_TIMEOUT_MS,
  });

  if (!result.isLive || !result.notices.length) {
    throw new Error('Library news refresh failed: no live notices were collected.');
  }

  const snapshot = await writeNewsSnapshot(result.notices, {
    source: result.source,
    collectedAt: new Date().toISOString(),
  });

  const body = {
    ok: true,
    source: result.source,
    count: snapshot.notices.length,
    refreshedAt: snapshot.refreshedAt,
    durationMs: Date.now() - startedAt,
  };
  console.log('[Library news refresh]', JSON.stringify(body));
  return response(200, body);
}
