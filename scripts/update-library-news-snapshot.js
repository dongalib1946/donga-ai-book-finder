const fs = require('fs');
const path = require('path');
const { fetchCommunityNoticeResult } = require('../netlify/functions/recommend-books.js');

const SNAPSHOT_PATH = path.join(__dirname, '..', 'netlify', 'data', 'library-news-snapshot.json');
const LIMIT = Math.min(10, Math.max(1, Number.parseInt(process.env.NEWS_SNAPSHOT_LIMIT || '5', 10) || 5));
const TIMEOUT_MS = Math.max(5000, Number.parseInt(process.env.NEWS_SNAPSHOT_FETCH_TIMEOUT_MS || '15000', 10) || 15000);

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

async function main() {
  const result = await fetchCommunityNoticeResult(LIMIT, {
    fresh: true,
    fastFallback: false,
    timeoutMs: TIMEOUT_MS,
  });

  if (!result.isLive || !result.notices.length) {
    throw new Error('No live library notices were collected.');
  }

  const existing = readExistingSnapshot();
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
