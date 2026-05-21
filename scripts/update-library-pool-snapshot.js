const fs = require('fs');
const path = require('path');
const { fetchLibraryPoolSnapshot } = require('../netlify/functions/recommend-books.js');

const SNAPSHOT_PATH = path.join(__dirname, '..', 'netlify', 'data', 'library-pool.json');
const PAGE_LIMIT = Math.min(100, Math.max(1, Number.parseInt(process.env.POOL_SNAPSHOT_PAGE_LIMIT || '50', 10) || 50));
const DELAY_MS = Math.max(0, Number.parseInt(process.env.POOL_SNAPSHOT_DELAY_MS || '800', 10) || 0);
const TIMEOUT_MS = Math.max(5000, Number.parseInt(process.env.POOL_SNAPSHOT_FETCH_TIMEOUT_MS || '15000', 10) || 15000);
const STALE_PAGE_LIMIT = Math.max(1, Number.parseInt(process.env.POOL_SNAPSHOT_STALE_PAGE_LIMIT || '2', 10) || 2);

function normalizeEntry(entry) {
  return {
    isbn: entry.isbn || '',
    title: entry.title || '',
    author: entry.author || '',
    meta: Array.isArray(entry.meta) ? entry.meta : [],
    cover: entry.cover || '',
    collection: entry.collection || '',
    collectionKeys: Array.isArray(entry.collectionKeys) ? entry.collectionKeys : [],
    collectionTags: Array.isArray(entry.collectionTags) ? entry.collectionTags : [],
    catalogUrl: entry.catalogUrl || '',
    ranks: entry.ranks || {},
  };
}

function readExistingSnapshot() {
  try {
    const value = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    return Array.isArray(value) ? value : value && Array.isArray(value.entries) ? value.entries : [];
  } catch {
    return [];
  }
}

function snapshotSignature(entries) {
  return JSON.stringify(entries.map(normalizeEntry));
}

async function main() {
  const result = await fetchLibraryPoolSnapshot({
    pageLimit: PAGE_LIMIT,
    delayMs: DELAY_MS,
    timeoutMs: TIMEOUT_MS,
    stalePageLimit: STALE_PAGE_LIMIT,
    logger: console,
  });
  const entries = result.entries.map(normalizeEntry);

  if (!entries.length) {
    throw new Error('No live library books were collected.');
  }

  const existing = readExistingSnapshot();
  if (snapshotSignature(existing) === snapshotSignature(entries)) {
    console.log(`Library pool snapshot is already up to date with ${entries.length} books.`);
    return;
  }

  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(entries, null, 2)}\n`);

  const collectionSummary = result.collections
    .map(collection => `${collection.key}:${collection.uniqueCount}/${collection.pagesVisited}p`)
    .join(', ');
  console.log(`Updated library pool snapshot with ${entries.length} books. ${collectionSummary}`);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
