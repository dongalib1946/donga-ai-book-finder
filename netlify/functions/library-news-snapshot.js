const STORE_NAME = 'library-news';
const SNAPSHOT_KEY = 'latest.json';
let blobsConnected = false;

function loadBlobs() {
  try {
    return require('@netlify/blobs');
  } catch (error) {
    console.warn('[Library news snapshot] Netlify Blobs unavailable:', error.message);
    return null;
  }
}

function getNewsStore() {
  if (!blobsConnected && !globalThis.netlifyBlobsContext && !process.env.NETLIFY_BLOBS_CONTEXT) return null;
  const blobs = loadBlobs();
  if (!blobs || typeof blobs.getStore !== 'function') return null;
  return blobs.getStore(STORE_NAME);
}

function connectNewsSnapshot(event) {
  const blobs = loadBlobs();
  if (!blobs || typeof blobs.connectLambda !== 'function' || !event || !event.blobs) return false;
  try {
    blobs.connectLambda(event);
    blobsConnected = true;
    return true;
  } catch (error) {
    console.warn('[Library news snapshot connect]', error.message);
    return false;
  }
}

function normalizeNotice(notice) {
  if (!notice || typeof notice !== 'object') return null;
  const title = String(notice.title || '').trim();
  const url = String(notice.url || '').trim();
  if (!title || !url) return null;
  return {
    title,
    url,
    author: String(notice.author || '').trim(),
    date: String(notice.date || '').trim(),
    views: String(notice.views || '').trim(),
    summary: String(notice.summary || '').trim(),
  };
}

function normalizeSnapshot(snapshot, limit = 5) {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.notices)) return null;
  const notices = snapshot.notices
    .map(normalizeNotice)
    .filter(Boolean)
    .slice(0, limit);
  if (!notices.length) return null;
  return {
    version: String(snapshot.version || 'library-news-v1'),
    refreshedAt: String(snapshot.refreshedAt || snapshot.updatedAt || ''),
    collectedAt: String(snapshot.collectedAt || snapshot.refreshedAt || snapshot.updatedAt || ''),
    source: String(snapshot.source || 'scheduled'),
    notices,
  };
}

async function readNewsSnapshot(limit = 5) {
  try {
    const store = getNewsStore();
    if (!store) return null;
    const snapshot = await store.get(SNAPSHOT_KEY, { type: 'json' });
    return normalizeSnapshot(snapshot, limit);
  } catch (error) {
    console.warn('[Library news snapshot read]', error.message);
    return null;
  }
}

async function writeNewsSnapshot(notices, details = {}) {
  const store = getNewsStore();
  if (!store) throw new Error('Netlify Blobs store is not available.');

  const normalized = (Array.isArray(notices) ? notices : [])
    .map(normalizeNotice)
    .filter(Boolean);
  if (!normalized.length) throw new Error('No valid library notices to snapshot.');

  const now = new Date().toISOString();
  const payload = {
    version: 'library-news-v1',
    refreshedAt: now,
    collectedAt: String(details.collectedAt || now),
    source: String(details.source || 'scheduled'),
    notices: normalized,
  };

  await store.setJSON(SNAPSHOT_KEY, payload, {
    metadata: {
      refreshedAt: payload.refreshedAt,
      source: payload.source,
      count: String(payload.notices.length),
    },
  });
  return payload;
}

function snapshotAgeSeconds(snapshot) {
  const timestamp = Date.parse(snapshot && snapshot.refreshedAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
}

module.exports = {
  connectNewsSnapshot,
  readNewsSnapshot,
  writeNewsSnapshot,
  snapshotAgeSeconds,
};
