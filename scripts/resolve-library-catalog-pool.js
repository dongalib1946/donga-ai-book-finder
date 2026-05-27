const fs = require('fs');
const path = require('path');

const LIBRARY_CATALOG_URL = 'https://library.donga.ac.kr/resource/library-catalog/';
const DEFAULT_INPUT = 'netlify/data/library-catalog-filtered.json';
const DEFAULT_OUTPUT = 'netlify/data/library-catalog-pool.json';

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const inline = process.argv.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function numberArg(name, fallback) {
  const value = Number.parseInt(argValue(name, ''), 10);
  return Number.isFinite(value) ? value : fallback;
}

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
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPersonName(value) {
  return cleanText(value)
    .replace(/\s*[,，、;；]+\s*$/g, '')
    .trim();
}

function normalizeIsbn(value) {
  const isbn = String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return isbn.length === 10 || isbn.length === 13 ? isbn : '';
}

function normalizeCatalogDetailUrl(value, baseUrl = LIBRARY_CATALOG_URL) {
  const url = new URL(String(value || '').replace(/&amp;/g, '&'), baseUrl);
  const recordId = url.searchParams.get('record_id') || (url.toString().match(/record_id=(\d+)/i) || [])[1];
  if (!recordId) return url.toString();
  const detail = new URL(LIBRARY_CATALOG_URL);
  detail.searchParams.set('app', 'mirtech');
  detail.searchParams.set('mod', 'detail');
  detail.searchParams.set('record_id', recordId);
  return detail.toString();
}

function normalizeCoverUrl(value, baseUrl) {
  const src = String(value || '').replace(/&amp;/g, '&').trim();
  if (!src || /thumb_book_175x246_none|book-default|no[_-]?image|placeholder/i.test(src)) return '';
  return new URL(src, baseUrl).toString();
}

function libraryCatalogSearchUrl(value, field = 'R') {
  const url = new URL(LIBRARY_CATALOG_URL);
  url.searchParams.set('app', 'mirtech');
  url.searchParams.set('mod', 'list');
  url.searchParams.set('st', '0');
  url.searchParams.append('field[]', field);
  url.searchParams.append('query[]', value);
  url.searchParams.append('material[]', 'DA');
  url.searchParams.append('collect[]', 'ALL');
  url.searchParams.append('ddc[]', 'ALL');
  url.searchParams.set('lang', 'ALL');
  url.searchParams.set('publish_s_year', '');
  url.searchParams.set('publish_e_year', '');
  url.searchParams.set('record_per_page', '10');
  url.searchParams.set('orderby', 'T');
  url.searchParams.set('order', 'asc');
  return url.toString();
}

function fieldFromClass(html, className) {
  const pattern = new RegExp(`<[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
  const match = String(html || '').match(pattern);
  return cleanText(match ? match[1] : '');
}

function titleParts(value) {
  const raw = cleanText(value);
  const withoutBracketed = raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const firstRaw = raw.split(/\s+(?:-|–|—|―)\s+|[:：|]/)[0];
  const firstWithoutBracketed = withoutBracketed.split(/\s+(?:-|–|—|―)\s+|[:：|]/)[0];
  return [...new Set([raw, withoutBracketed, firstRaw, firstWithoutBracketed].map(cleanText).filter(Boolean))];
}

function comparableTitle(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleBases(value) {
  return titleParts(value).map(comparableTitle).filter(Boolean);
}

function titlesMatch(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 4 && longer.includes(shorter);
}

function parseCatalogEntries(baseUrl, html) {
  const entries = [];
  const seen = new Set();
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    const attrs = match[1];
    const hrefMatch = attrs.match(/\bhref=["']([^"']*record_id=\d+[^"']*)["']/i);
    if (!hrefMatch) continue;

    const nearby = String(html || '').slice(Math.max(0, match.index - 1600), match.index + match[0].length + 2200);
    const catalogUrl = normalizeCatalogDetailUrl(hrefMatch[1], baseUrl);
    const recordId = (catalogUrl.match(/record_id=(\d+)/i) || [])[1] || catalogUrl;
    if (seen.has(recordId)) continue;
    seen.add(recordId);

    const isbnMatch = attrs.match(/\bisbn=["']([^"']+)["']/i) || nearby.match(/\bisbn=["']([^"']+)["']/i);
    const title = fieldFromClass(nearby, 'item-subject') || cleanText(match[2]);
    const optionCells = [...nearby.matchAll(/<div\b[^>]*class=["'][^"']*\bitem-option-cell\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
      .map(item => cleanText(item[1]))
      .filter(Boolean);
    const imageMatch = nearby.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
    entries.push({
      recordId,
      isbn: normalizeIsbn(isbnMatch && isbnMatch[1]),
      title,
      author: cleanPersonName(optionCells[0] || ''),
      meta: [...new Set(optionCells.slice(1))],
      callNo: fieldFromClass(nearby, 'item-mark').replace(/^\[\s*|\s*\]$/g, '').trim(),
      cover: normalizeCoverUrl(imageMatch && imageMatch[1], baseUrl),
      catalogUrl,
    });
  }
  return entries;
}

function selectBestEntry(row, entries) {
  if (!entries.length) return null;
  const rowTitles = titleBases(row.title);
  const rowCall = cleanText(row.callNo).replace(/\s*=\s*\d+\s*$/, '');
  const byTitle = entries.filter(entry => {
    const entryTitles = titleBases(entry.title);
    return rowTitles.some(left => entryTitles.some(right => titlesMatch(left, right)));
  });
  const source = byTitle.length ? byTitle : entries;
  if (rowCall) {
    const byCall = source.find(entry => cleanText(entry.callNo).replace(/\s*=\s*\d+\s*$/, '').includes(rowCall));
    if (byCall) return byCall;
  }
  return source[0];
}

function inferTags(row) {
  const text = [row.title, row.author, row.callNo].map(cleanText).join(' ');
  const compact = cleanText(row.callNo);
  const tags = new Set(['catalog', 'readable']);
  if (/소설|장편|단편|문학|시집|희곡|작가/.test(text) || /^8/.test(compact)) tags.add('literature'), tags.add('story');
  if (/에세이|산문|수필/.test(text)) tags.add('essay');
  if (/철학|사상|윤리|심리/.test(text) || /^1/.test(compact)) tags.add('philosophy'), tags.add('humanities');
  if (/심리|마음|감정/.test(text)) tags.add('psychology'), tags.add('mind');
  if (/역사|세계사|한국사|문명/.test(text) || /^9/.test(compact)) tags.add('history');
  if (/과학|물리|화학|생명|우주|수학/.test(text) || /^5/.test(compact)) tags.add('science'), tags.add('knowledge');
  if (/경제|경영|투자|시장|마케팅/.test(text) || /^3/.test(compact)) tags.add('society');
  if (/예술|미술|음악|영화|디자인/.test(text) || /^7/.test(compact)) tags.add('art'), tags.add('culture');
  if (/여행|기행|답사/.test(text)) tags.add('travel');
  if (/자기계발|성공|습관|성장|리더십/.test(text)) tags.add('growth'), tags.add('practical');
  return [...tags];
}

function toPoolEntry(row, found, rank) {
  const recordId = found && found.recordId ? found.recordId : '';
  const pseudoId = recordId ? `catalog-${recordId}` : `reg-${row.regNo}`;
  const meta = [...new Set([
    ...((found && found.meta) || []),
    row.year ? `출판년도 ${row.year}` : '',
    row.location ? row.location : '',
  ].map(cleanText).filter(Boolean))];
  return {
    isbn: (found && found.isbn) || pseudoId,
    title: cleanText((found && found.title) || row.title),
    author: cleanPersonName((found && found.author) || row.author),
    meta,
    cover: (found && found.cover) || '',
    collection: '도서관 소장자료',
    collectionKeys: ['catalog'],
    collectionTags: inferTags(row),
    catalogUrl: (found && found.catalogUrl) || libraryCatalogSearchUrl(row.regNo || row.title, row.regNo ? 'R' : 'T'),
    ranks: { catalog: rank },
    regNo: row.regNo || '',
    callNo: cleanText((found && found.callNo) || row.callNo),
    location: row.location || '',
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, timeoutMs, retries) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; donga-ai-book-finder/1.0)' },
      });
      const text = await res.text();
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return text;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    }
  }
  throw lastError;
}

async function resolveRow(row, rank, options) {
  const value = row.regNo || row.title;
  const field = row.regNo ? 'R' : 'T';
  const searchUrl = libraryCatalogSearchUrl(value, field);
  const html = await fetchWithTimeout(searchUrl, options.timeoutMs, options.retries);
  const found = selectBestEntry(row, parseCatalogEntries(searchUrl, html));
  if (!found && options.skipUnresolved) return null;
  return toPoolEntry(row, found, rank);
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const inputPath = argValue('input', DEFAULT_INPUT);
  const outputPath = argValue('output', DEFAULT_OUTPUT);
  const failPath = argValue('failures', `${outputPath}.failures.json`);
  const limit = numberArg('limit', 0);
  const offset = numberArg('offset', 0);
  const delayMs = numberArg('delay-ms', 120);
  const saveEvery = Math.max(1, numberArg('save-every', 50));
  const timeoutMs = numberArg('timeout-ms', 10000);
  const retries = numberArg('retries', 1);
  const skipUnresolved = process.argv.includes('--skip-unresolved');
  const resume = !process.argv.includes('--no-resume');

  const rows = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const selectedRows = rows.slice(offset, limit ? offset + limit : undefined);
  const selectedRegNos = new Set(selectedRows.map(row => row.regNo).filter(Boolean));
  const existingRaw = resume ? readJsonIfExists(outputPath, []) : [];
  const failuresRaw = resume ? readJsonIfExists(failPath, []) : [];
  const existing = existingRaw.filter(entry => !entry.regNo || selectedRegNos.has(entry.regNo));
  const failures = failuresRaw.filter(entry => !entry.regNo || selectedRegNos.has(entry.regNo));
  const doneRegNos = new Set(existing.map(entry => entry.regNo).filter(Boolean));
  const pendingRows = selectedRows.filter(row => !row.regNo || !doneRegNos.has(row.regNo));

  console.log(JSON.stringify({
    inputPath,
    outputPath,
    failPath,
    selected: selectedRows.length,
    existing: existing.length,
    ignoredExisting: existingRaw.length - existing.length,
    ignoredFailures: failuresRaw.length - failures.length,
    pending: pendingRows.length,
    delayMs,
    timeoutMs,
    retries,
    skipUnresolved,
  }, null, 2));

  const results = existing;
  let processed = 0;
  for (const row of pendingRows) {
    processed += 1;
    const rank = offset + results.length + 1;
    try {
      const entry = await resolveRow(row, rank, { timeoutMs, retries, skipUnresolved });
      if (entry) results.push(entry);
    } catch (error) {
      failures.push({
        regNo: row.regNo || '',
        title: row.title || '',
        message: error && error.message ? error.message : String(error),
      });
    }

    if (processed % saveEvery === 0) {
      writeJson(outputPath, results);
      writeJson(failPath, failures);
      console.log(`saved ${results.length} entries, ${failures.length} failures (${processed}/${pendingRows.length})`);
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  writeJson(outputPath, results);
  writeJson(failPath, failures);
  console.log(`done ${results.length} entries, ${failures.length} failures`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
