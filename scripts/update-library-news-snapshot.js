const fs = require('fs');
const path = require('path');
const { fetchCommunityNoticeResult } = require('../netlify/functions/recommend-books.js');

const SNAPSHOT_PATH = path.join(__dirname, '..', 'netlify', 'data', 'library-news-snapshot.json');
const LIMIT = Math.min(10, Math.max(1, Number.parseInt(process.env.NEWS_SNAPSHOT_LIMIT || '5', 10) || 5));
const TIMEOUT_MS = Math.max(5000, Number.parseInt(process.env.NEWS_SNAPSHOT_FETCH_TIMEOUT_MS || '15000', 10) || 15000);
const FETCH_RETRIES = Math.max(0, Number.parseInt(process.env.NEWS_SNAPSHOT_FETCH_RETRIES || '2', 10) || 0);
const RETRY_DELAY_MS = Math.max(0, Number.parseInt(process.env.NEWS_SNAPSHOT_RETRY_DELAY_MS || '1500', 10) || 0);

function noticeSignature(notices) {
  return JSON.stringify((notices || []).map(notice => ({
    title: notice.title || '',
    url: notice.url || '',
    thumbnail: notice.thumbnail || '',
    date: notice.date || '',
  })));
}

function readExistingSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function hasUsableSnapshot(snapshot) {
  return Boolean(snapshot && Array.isArray(snapshot.notices) && snapshot.notices.length);
}

async function main() {
  const existing = readExistingSnapshot();
  let result;

  try {
    result = await fetchCommunityNoticeResult(LIMIT, {
      fresh: true,
      fastFallback: false,
      timeoutMs: TIMEOUT_MS,
      retries: FETCH_RETRIES,
      retryDelayMs: RETRY_DELAY_MS,
    });
  } catch (error) {
    if (hasUsableSnapshot(existing)) {
      console.warn(`Live library news collection failed. Keeping existing snapshot from ${existing.refreshedAt || 'unknown time'}.`);
      console.warn(error && error.message ? error.message : error);
      return;
    }
    throw error;
  }

  if (!result.isLive || !result.notices.length) {
    if (hasUsableSnapshot(existing)) {
      console.warn(`No live library notices were collected. Keeping existing snapshot from ${existing.refreshedAt || 'unknown time'}.`);
      return;
    }
    throw new Error('No live library notices were collected.');
  }

  if (existing && noticeSignature(existing.notices) === noticeSignature(result.notices)) {
    console.log('Library news snapshot is already up to date.');
    return;
  }

  const now = new Date().toISOString();
  const payload = {
    version: 'library-news-v1',
    refreshedAt: now,
    collectedAt: now,
    source: `github-action:${result.source}`,
    notices: result.notices,
  };

  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Updated library news snapshot with ${payload.notices.length} notices from ${result.source}.`);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
