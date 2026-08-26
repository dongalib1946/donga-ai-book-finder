const fs = require('fs');
const path = require('path');

const ALADIN_LOOKUP_URL = 'https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx';
const NETLIFY_OUTPUT = path.join(__dirname, '..', 'netlify', 'data', 'aladin-descriptions.json');
const PUBLIC_OUTPUT = path.join(__dirname, '..', 'public', 'data', 'aladin-descriptions.json');
const LIBRARY_POOL_PATH = path.join(__dirname, '..', 'netlify', 'data', 'library-pool.json');
const CATALOG_POOL_PATH = path.join(__dirname, '..', 'netlify', 'data', 'library-catalog-pool.json');
const BESTSELLERS_PATH = path.join(__dirname, '..', 'netlify', 'data', 'aladin-bestsellers.json');
const LOOKUP_LIMIT = Math.min(1000, Math.max(1, Number.parseInt(process.env.ALADIN_DESCRIPTION_LOOKUP_LIMIT || '360', 10) || 360));
const BATCH_SIZE = Math.min(8, Math.max(1, Number.parseInt(process.env.ALADIN_DESCRIPTION_BATCH_SIZE || '4', 10) || 4));
const DELAY_MS = Math.max(0, Number.parseInt(process.env.ALADIN_DESCRIPTION_DELAY_MS || '120', 10) || 0);
const DESCRIPTION_MAX_LENGTH = 520;

function cleanText(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIsbn(value) {
  const isbn = String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return isbn.length === 10 || isbn.length === 13 ? isbn : '';
}

function compactDescription(value) {
  const text = cleanText(value);
  if (text.length <= DESCRIPTION_MAX_LENGTH) return text;
  const sliced = text.slice(0, DESCRIPTION_MAX_LENGTH + 1);
  const boundary = Math.max(
    sliced.lastIndexOf('.'),
    sliced.lastIndexOf('!'),
    sliced.lastIndexOf('?'),
    sliced.lastIndexOf('다.'),
    sliced.lastIndexOf('요.')
  );
  if (boundary >= 120) return `${sliced.slice(0, boundary + 1).trim()}...`;
  return `${text.slice(0, DESCRIPTION_MAX_LENGTH).trim()}...`;
}

function largerCover(value) {
  return String(value || '')
    .trim()
    .replace(/^http:\/\//i, 'https://')
    .replace(/\/cover\d+\//i, '/cover500/');
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isUsefulExisting(item) {
  return item && normalizeIsbn(item.isbn) && cleanText(item.description);
}

function entryPriority(entry, sourceName, index) {
  let score = sourceName === 'library-pool' ? 80 : sourceName === 'bestseller' ? 76 : 30;
  const keys = new Set([...(entry.collectionKeys || []), ...(entry.collectionTags || [])].map(String));
  if (keys.has('popular')) score += 14;
  if (keys.has('new')) score += 12;
  if (entry.aladin && entry.aladin.link) score += 10;
  if (entry.cover || (entry.aladin && entry.aladin.cover)) score += 4;
  score -= Math.min(index, 3000) / 1000;
  return score;
}

function addCandidate(candidates, seen, entry, sourceName, index) {
  const isbn = normalizeIsbn(entry && entry.isbn);
  if (!isbn || seen.has(isbn)) return;
  const aladin = entry.aladin || {};
  seen.add(isbn);
  candidates.push({
    isbn,
    title: cleanText(entry.title),
    author: cleanText(entry.author),
    publisher: cleanText(entry.publisher),
    link: cleanText(entry.link || aladin.link),
    cover: largerCover(entry.cover || aladin.cover),
    categoryName: cleanText(entry.categoryName || aladin.categoryName),
    priority: entryPriority(entry, sourceName, index),
  });
}

function buildCandidates(existingByIsbn) {
  const seen = new Set(existingByIsbn.keys());
  const candidates = [];
  const libraryPool = readJson(LIBRARY_POOL_PATH, []);
  const catalogPool = readJson(CATALOG_POOL_PATH, []);
  const bestsellers = readJson(BESTSELLERS_PATH, { items: [] });

  (Array.isArray(bestsellers.items) ? bestsellers.items : []).forEach((entry, index) => {
    addCandidate(candidates, seen, entry, 'bestseller', index);
  });
  (Array.isArray(libraryPool) ? libraryPool : []).forEach((entry, index) => {
    addCandidate(candidates, seen, entry, 'library-pool', index);
  });
  (Array.isArray(catalogPool) ? catalogPool : [])
    .filter(entry => entry && entry.aladin && entry.aladin.link)
    .forEach((entry, index) => {
      addCandidate(candidates, seen, entry, 'catalog-pool', index);
    });

  return candidates
    .filter(item => item.title)
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, 'ko'))
    .slice(0, LOOKUP_LIMIT);
}

async function lookupDescription(ttbKey, candidate) {
  const url = new URL(ALADIN_LOOKUP_URL);
  url.searchParams.set('ttbkey', ttbKey);
  url.searchParams.set('ItemId', candidate.isbn);
  url.searchParams.set('ItemIdType', candidate.isbn.length === 13 ? 'ISBN13' : 'ISBN');
  url.searchParams.set('Cover', 'Big');
  url.searchParams.set('output', 'js');
  url.searchParams.set('Version', '20131101');

  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = JSON.parse(text);
  if (payload.errorCode) throw new Error(payload.errorMessage || payload.errorCode);
  const item = Array.isArray(payload.item) ? payload.item[0] : null;
  const description = compactDescription(item && item.description);
  if (!item || !description) return null;

  return {
    isbn: candidate.isbn,
    title: cleanText(item.title || candidate.title),
    author: cleanText(item.author || candidate.author),
    publisher: cleanText(item.publisher || candidate.publisher),
    description,
    link: cleanText(item.link || candidate.link),
    cover: largerCover(item.cover || candidate.cover),
    categoryName: cleanText(item.categoryName || candidate.categoryName),
    updatedAt: new Date().toISOString(),
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const ttbKey = process.env.ALADIN_TTB_KEY || '';
  if (!ttbKey) throw new Error('ALADIN_TTB_KEY GitHub Secret is required.');

  const existing = readJson(NETLIFY_OUTPUT, { items: [] });
  const existingItems = Array.isArray(existing.items) ? existing.items.filter(isUsefulExisting) : [];
  const existingByIsbn = new Map(existingItems.map(item => [normalizeIsbn(item.isbn), item]));
  const candidates = buildCandidates(existingByIsbn);
  let updated = 0;
  let missed = 0;

  for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
    const batch = candidates.slice(start, start + BATCH_SIZE);
    const results = await Promise.all(batch.map(async candidate => {
      try {
        return await lookupDescription(ttbKey, candidate);
      } catch (error) {
        console.warn(`[Aladin description] ${candidate.isbn} ${candidate.title}: ${error.message}`);
        return null;
      }
    }));

    results.forEach(item => {
      if (item && item.description) {
        existingByIsbn.set(item.isbn, item);
        updated += 1;
      } else {
        missed += 1;
      }
    });

    if (DELAY_MS > 0 && start + BATCH_SIZE < candidates.length) {
      await sleep(DELAY_MS);
    }
  }

  const output = {
    version: 'aladin-descriptions-v1',
    source: 'Aladin ItemLookUp API',
    generatedAt: new Date().toISOString(),
    lookupLimit: LOOKUP_LIMIT,
    total: existingByIsbn.size,
    items: [...existingByIsbn.values()].sort((a, b) => a.title.localeCompare(b.title, 'ko')),
  };

  writeJson(NETLIFY_OUTPUT, output);
  writeJson(PUBLIC_OUTPUT, output);
  console.log(`Updated Aladin descriptions: ${updated} added, ${missed} without descriptions, ${output.total} total.`);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
