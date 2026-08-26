const fs = require('fs');
const path = require('path');

const ALADIN_LOOKUP_URL = 'https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx';
const NETLIFY_OUTPUT = path.join(__dirname, '..', 'netlify', 'data', 'aladin-descriptions.json');
const PUBLIC_OUTPUT = path.join(__dirname, '..', 'public', 'data', 'aladin-descriptions.json');
const LIBRARY_POOL_PATH = path.join(__dirname, '..', 'netlify', 'data', 'library-pool.json');
const BESTSELLERS_PATH = path.join(__dirname, '..', 'netlify', 'data', 'aladin-bestsellers.json');
const LOOKUP_LIMIT = Math.min(160, Math.max(1, Number.parseInt(process.env.ALADIN_DESCRIPTION_LOOKUP_LIMIT || '120', 10) || 120));
const BATCH_SIZE = Math.min(4, Math.max(1, Number.parseInt(process.env.ALADIN_DESCRIPTION_BATCH_SIZE || '2', 10) || 2));
const DELAY_MS = Math.max(0, Number.parseInt(process.env.ALADIN_DESCRIPTION_DELAY_MS || '250', 10) || 0);
const DESCRIPTION_MAX_LENGTH = Math.min(240, Math.max(80, Number.parseInt(process.env.ALADIN_DESCRIPTION_MAX_LENGTH || '180', 10) || 180));
const BESTSELLER_DESCRIPTION_QUOTA = 12;
const CATEGORY_DESCRIPTION_QUOTA = Math.max(4, Math.floor((LOOKUP_LIMIT - BESTSELLER_DESCRIPTION_QUOTA) / 10));

const CATEGORY_GROUPS = [
  { id: 'novel', tags: ['novel', 'literature', 'story', 'mystery', 'classic'], keywords: ['소설', '문학', '장편', '미스터리', '추리', '로맨스', 'SF'] },
  { id: 'essay', tags: ['essay', 'life', 'mind', 'comfort', 'healing'], keywords: ['에세이', '산문', '마음', '일상', '사랑', '행복', '시집'] },
  { id: 'self_development', tags: ['growth', 'career', 'practical', 'work', 'challenge', 'identity'], keywords: ['자기계발', '성공', '리더십', '습관', '커리어', '취업', '실용'] },
  { id: 'humanities_philosophy', tags: ['humanities', 'philosophy', 'history', 'deep', 'society', 'classic'], keywords: ['인문', '철학', '역사', '고전', '사상', '문명', '사회'] },
  { id: 'psychology', tags: ['psychology', 'mind', 'relationship', 'comfort', 'healing'], keywords: ['심리', '마음', '감정', '관계', '정신'] },
  { id: 'economy_business', tags: ['economy', 'business', 'work', 'practical', 'career'], keywords: ['경제', '경영', '투자', '마케팅', '비즈니스', '금융', '시장'] },
  { id: 'science', tags: ['science', 'technology', 'future', 'knowledge'], keywords: ['과학', '기술', 'AI', '인공지능', '우주', '수학', '뇌'] },
  { id: 'society', tags: ['society', 'history', 'humanities', 'knowledge'], keywords: ['사회', '정치', '문화', '제도', '젠더'] },
  { id: 'art_culture', tags: ['art', 'culture', 'literature'], keywords: ['예술', '문화', '미술', '음악', '영화', '디자인'] },
  { id: 'travel_hobby', tags: ['travel', 'life', 'fun', 'art'], keywords: ['여행', '취미', '요리', '공간', '걷다'] },
];

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
  if (boundary >= 80) return `${sliced.slice(0, boundary + 1).trim()}...`;
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
  if (keys.has('recommend')) score += 10;
  if (keys.has('monthly')) score += 8;
  if (keys.has('readable')) score += 6;
  if (entry.aladin && entry.aladin.link) score += 10;
  if (entry.cover || (entry.aladin && entry.aladin.cover)) score += 4;
  score -= Math.min(index, 3000) / 1000;
  return score;
}

function entryText(entry) {
  const aladin = entry && entry.aladin ? entry.aladin : {};
  return cleanText([
    entry && entry.title,
    entry && entry.author,
    entry && entry.publisher,
    entry && entry.collection,
    entry && Array.isArray(entry.meta) ? entry.meta.join(' ') : '',
    aladin.categoryName,
  ].join(' ')).toLowerCase();
}

function entryMatchesCategory(entry, group) {
  const tags = new Set([...(entry.collectionKeys || []), ...(entry.collectionTags || [])].map(String));
  if (group.tags.some(tag => tags.has(tag))) return true;
  const text = entryText(entry);
  return group.keywords.some(keyword => text.includes(keyword.toLowerCase()));
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

function buildCandidates() {
  const seen = new Set();
  const candidates = [];
  const libraryPool = readJson(LIBRARY_POOL_PATH, []);
  const bestsellers = readJson(BESTSELLERS_PATH, { items: [] });
  const libraryCandidates = (Array.isArray(libraryPool) ? libraryPool : [])
    .map((entry, index) => ({ entry, index, priority: entryPriority(entry, 'library-pool', index) }))
    .filter(item => item.entry && item.entry.title && normalizeIsbn(item.entry.isbn))
    .sort((a, b) => b.priority - a.priority || cleanText(a.entry.title).localeCompare(cleanText(b.entry.title), 'ko'));

  (Array.isArray(bestsellers.items) ? bestsellers.items : []).slice(0, BESTSELLER_DESCRIPTION_QUOTA).forEach((entry, index) => {
    addCandidate(candidates, seen, entry, 'bestseller', index);
  });

  CATEGORY_GROUPS.forEach(group => {
    libraryCandidates
      .filter(item => entryMatchesCategory(item.entry, group))
      .slice(0, CATEGORY_DESCRIPTION_QUOTA)
      .forEach(item => {
        addCandidate(candidates, seen, item.entry, 'library-pool', item.index);
      });
  });

  libraryCandidates.forEach(item => {
    addCandidate(candidates, seen, item.entry, 'library-pool', item.index);
  });

  return candidates.slice(0, LOOKUP_LIMIT);
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
    headers: {
      accept: 'application/json',
      'user-agent': 'donga-ai-book-finder/1.0 (+https://github.com/dongalib1946/donga-ai-book-finder)',
    },
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
    description,
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
  const candidates = buildCandidates();
  const outputItems = new Map();
  let updated = 0;
  let reused = 0;
  let missed = 0;

  for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
    const batch = candidates.slice(start, start + BATCH_SIZE);
    const results = await Promise.all(batch.map(async candidate => {
      const existingItem = existingByIsbn.get(candidate.isbn);
      if (existingItem) {
        return {
          isbn: candidate.isbn,
          title: candidate.title || cleanText(existingItem.title),
          description: compactDescription(existingItem.description),
          updatedAt: existingItem.updatedAt || new Date().toISOString(),
          reused: true,
        };
      }
      try {
        return await lookupDescription(ttbKey, candidate);
      } catch (error) {
        console.warn(`[Aladin description] ${candidate.isbn} ${candidate.title}: ${error.message}`);
        return null;
      }
    }));

    results.forEach(item => {
      if (item && item.description) {
        const { reused: isReused, ...storedItem } = item;
        outputItems.set(item.isbn, storedItem);
        if (isReused) reused += 1;
        else updated += 1;
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
    descriptionMaxLength: DESCRIPTION_MAX_LENGTH,
    total: outputItems.size,
    items: candidates
      .map(candidate => outputItems.get(candidate.isbn))
      .filter(Boolean),
  };

  writeJson(NETLIFY_OUTPUT, output);
  writeJson(PUBLIC_OUTPUT, output);
  console.log(`Updated Aladin descriptions: ${updated} looked up, ${reused} reused, ${missed} without descriptions, ${output.total} total.`);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
