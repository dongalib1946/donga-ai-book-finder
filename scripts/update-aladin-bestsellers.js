const fs = require('fs');
const path = require('path');

const ALADIN_ITEM_LIST_URL = 'https://www.aladin.co.kr/ttb/api/ItemList.aspx';
const NETLIFY_OUTPUT = path.join(__dirname, '..', 'netlify', 'data', 'aladin-bestsellers.json');
const PUBLIC_OUTPUT = path.join(__dirname, '..', 'public', 'data', 'aladin-bestsellers.json');
const MAX_RESULTS = Math.min(50, Math.max(6, Number.parseInt(process.env.ALADIN_BESTSELLER_MAX_RESULTS || '20', 10) || 20));

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIsbn(value) {
  const isbn = String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return isbn.length === 10 || isbn.length === 13 ? isbn : '';
}

function largerCover(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  return url
    .replace(/^http:\/\//i, 'https://')
    .replace(/\/cover\d+\//i, '/cover500/');
}

function isExamPrepBook(item) {
  const text = cleanText([
    item.title,
    item.author,
    item.publisher,
    item.categoryName,
  ].join(' '));
  return /수험|문제|기출|모의고사|공무원|자격증|토익|TOEIC|토플|TOEFL|JLPT|편입|PSAT|LEET|수능|고시|교재/.test(text);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fetchBestsellers(ttbKey) {
  const url = new URL(ALADIN_ITEM_LIST_URL);
  url.searchParams.set('ttbkey', ttbKey);
  url.searchParams.set('QueryType', 'Bestseller');
  url.searchParams.set('SearchTarget', 'Book');
  url.searchParams.set('MaxResults', String(MAX_RESULTS));
  url.searchParams.set('Cover', 'Big');
  url.searchParams.set('output', 'js');
  url.searchParams.set('Version', '20131101');

  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Aladin API failed: HTTP ${response.status}`);

  const payload = JSON.parse(text);
  if (payload.errorCode) {
    throw new Error(payload.errorMessage || payload.errorCode);
  }

  return (Array.isArray(payload.item) ? payload.item : [])
    .filter(item => item && !isExamPrepBook(item))
    .slice(0, 12)
    .map((item, index) => ({
      rank: index + 1,
      title: cleanText(item.title),
      author: cleanText(item.author),
      publisher: cleanText(item.publisher),
      cover: largerCover(item.cover),
      link: cleanText(item.link),
      isbn: normalizeIsbn(item.isbn13 || item.isbn),
      categoryName: cleanText(item.categoryName),
      requestUrl: 'https://library.donga.ac.kr/libaray-services/using-materials/purchase-request/#',
      actionLabel: '도서관 소장 확인',
      actionUrl: '',
      isOwned: false,
      holdingChecked: false,
    }))
    .filter(item => item.title);
}

async function main() {
  const ttbKey = process.env.ALADIN_TTB_KEY || '';
  if (!ttbKey) {
    throw new Error('ALADIN_TTB_KEY GitHub Secret is required.');
  }

  const generatedAt = new Date().toISOString();
  const items = await fetchBestsellers(ttbKey);
  const output = {
    version: 'aladin-bestsellers-v1',
    source: 'Aladin ItemList Bestseller API',
    generatedAt,
    items,
  };

  writeJson(NETLIFY_OUTPUT, output);
  writeJson(PUBLIC_OUTPUT, output);
  console.log(`Updated Aladin bestsellers with ${items.length} books.`);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
