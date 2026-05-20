const crypto = require('crypto');

const ALADIN_LOOKUP_URL = 'https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx';
const ALADIN_ITEM_LIST_URL = 'https://www.aladin.co.kr/ttb/api/ItemList.aspx';
const ALADIN_SEARCH_URL = 'https://www.aladin.co.kr/search/wsearchresult.aspx';
const ALADIN_PRODUCT_URL = 'https://www.aladin.co.kr/shop/wproduct.aspx';
const LIBRARY_COMMUNITY_URL = 'https://library.donga.ac.kr/community/notice/';
const LIBRARY_POSTS_API_URL = 'https://library.donga.ac.kr/wp-json/wp/v2/posts';
const LIBRARY_FEED_URL = 'https://library.donga.ac.kr/feed/';
const LIBRARY_CATALOG_URL = 'https://library.donga.ac.kr/resource/library-catalog/';
const LIBRARY_CATALOG_REST_URL = 'https://library.donga.ac.kr/wp-json/wp/v2/pages/17';
const LIBRARY_PAGES_REST_URL = 'https://library.donga.ac.kr/wp-json/wp/v2/pages/';
const PURCHASE_REQUEST_URL = 'https://library.donga.ac.kr/libaray-services/using-materials/purchase-request/#';
const FETCH_TIMEOUT_MS = Number.parseInt(process.env.FETCH_TIMEOUT_MS || '2500', 10);
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const NOTICE_CACHE_TTL_MS = Math.max(0, Number.parseInt(process.env.NOTICE_CACHE_TTL_MS || String(60 * 1000), 10) || 0);
const NOTICE_FETCH_TIMEOUT_MS = Math.min(1200, Math.max(500, Number.parseInt(process.env.NOTICE_FETCH_TIMEOUT_MS || '900', 10) || 900));
const BESTSELLER_CACHE_TTL_MS = Number.parseInt(process.env.BESTSELLER_CACHE_TTL_MS || String(60 * 1000), 10);
const COLLECTION_PAGE_LIMIT = Math.max(1, Number.parseInt(process.env.COLLECTION_PAGE_LIMIT || '1', 10) || 1);
const COLLECTION_RECORD_PER_PAGE = Math.min(120, Math.max(12, Number.parseInt(process.env.COLLECTION_RECORD_PER_PAGE || '120', 10) || 120));
const ALADIN_LOOKUP_TIMEOUT_MS = Math.max(1800, Number.parseInt(process.env.ALADIN_LOOKUP_TIMEOUT_MS || '2500', 10) || 2500);
const MAIN_ENRICH_LOOKUP_LIMIT = Math.max(6, Number.parseInt(process.env.MAIN_ENRICH_LOOKUP_LIMIT || '6', 10) || 6);
const MAIN_CANDIDATE_POOL_LIMIT = Math.max(MAIN_ENRICH_LOOKUP_LIMIT, Number.parseInt(process.env.MAIN_CANDIDATE_POOL_LIMIT || '70', 10) || 70);
const MAIN_EXTRA_COVER_LOOKUP_LIMIT = Math.max(0, Number.parseInt(process.env.MAIN_EXTRA_COVER_LOOKUP_LIMIT || '0', 10) || 0);
const POPULAR_ENRICH_LOOKUP_LIMIT = Math.max(5, Number.parseInt(process.env.POPULAR_ENRICH_LOOKUP_LIMIT || '5', 10) || 5);
const POPULAR_COVER_LOOKUP_LIMIT = Math.max(0, Number.parseInt(process.env.POPULAR_COVER_LOOKUP_LIMIT || '5', 10) || 0);
const BESTSELLER_HOLDING_TIMEOUT_MS = Math.max(2500, Number.parseInt(process.env.BESTSELLER_HOLDING_TIMEOUT_MS || '10000', 10) || 10000);
const API_VERSION = 'ai-book-finder-v1';
const MAIN_COLLECTION_CAPS = { popular: 2 };

let poolCache = null;
let noticeCache = null;
let lastNoticeSource = '';
let bestSellerCache = null;
let snapshotPoolCache = null;

function collectionUrl(value) {
  const url = new URL(value);
  url.searchParams.set('record_per_page', String(COLLECTION_RECORD_PER_PAGE));
  return url.toString();
}

function collectionRestUrl(pageId) {
  const url = new URL(String(pageId), LIBRARY_PAGES_REST_URL);
  url.searchParams.set('record_per_page', String(COLLECTION_RECORD_PER_PAGE));
  return url.toString();
}

const COLLECTIONS = [
  { key: 'new', name: '신착도서', url: collectionUrl('https://library.donga.ac.kr/resource/collections/new-arrivals/'), restUrl: collectionRestUrl(29), tags: ['new', 'fresh'] },
  { key: 'popular', name: '인기도서', url: collectionUrl('https://library.donga.ac.kr/resource/collections/popular-books/'), restUrl: collectionRestUrl(31), tags: ['popular', 'readable'] },
  { key: 'recommend', name: '신간추천도서', url: collectionUrl('https://library.donga.ac.kr/resource/collections/new_recommendations/'), restUrl: collectionRestUrl(37), tags: ['recommended', 'new'] },
  { key: 'monthly', name: '이달의 책', url: collectionUrl('https://library.donga.ac.kr/resource/collections/monthly-choices/'), restUrl: collectionRestUrl(35), tags: ['recommended', 'essay'] },
  { key: 'classic', name: '고전', url: collectionUrl('https://library.donga.ac.kr/resource/collections/classics/'), restUrl: collectionRestUrl(30703), tags: ['classic', 'deep'] },
  { key: 'gallery', name: '북갤러리', url: collectionUrl('https://library.donga.ac.kr/resource/collections/book-gallery/'), restUrl: collectionRestUrl(10378), tags: ['art', 'culture'] },
];

const FALLBACK_ENTRIES = [
  { isbn: '9788973814725', title: '멋진 신세계', author: 'Aldous Huxley', publisher: '소담출판사', tags: ['novel', 'future', 'society', 'classic'] },
  { isbn: '9791190090261', title: '천 개의 파랑 :천선란 장편소설', author: '천선란', publisher: '허블', tags: ['novel', 'science', 'future', 'comfort'] },
  { isbn: '9788925588735', title: '프로젝트 헤일메리', author: 'Andy Weir', publisher: 'RHK', tags: ['science', 'future', 'story', 'readable'] },
  { isbn: '9791194330424', title: '넥서스', author: 'Yuval Noah Harari', publisher: '김영사', tags: ['technology', 'future', 'society', 'knowledge'] },
  { isbn: '9788937473401', title: '급류 :정대건 장편소설', author: '정대건', publisher: '민음사', tags: ['novel', 'story', 'literature', 'relationship'] },
  { isbn: '9788962630619', title: '침묵의 봄', author: 'Rachel Carson', publisher: '에코리브르', tags: ['science', 'society', 'deep', 'knowledge'] },
  { isbn: '9788958287155', title: '세상물정의 사회학 :세속을 산다는 것에 대하여', author: '노명우', publisher: '사계절', tags: ['society', 'humanities', 'knowledge', 'life'] },
  { isbn: '9788937461491', title: '무진기행 :김승옥 소설집', author: '김승옥', publisher: '민음사', tags: ['literature', 'classic', 'story', 'deep'] },
  { isbn: '8935656615', title: '예루살렘의 아이히만', author: 'Hannah Arendt', publisher: '한길사', tags: ['philosophy', 'history', 'society', 'deep'] },
  { isbn: '9788994478258', title: '왜 세계는 불평등한가 :탐욕스러운 1%가 99%의 삶을 파괴한다', author: '', publisher: '', tags: ['society', 'history', 'knowledge', 'deep'] },
  { isbn: '9788964061503', title: '미디어의 이해 :인간의 확장', author: 'Marshall McLuhan', publisher: '커뮤니케이션북스', tags: ['society', 'technology', 'knowledge', 'humanities'] },
  { isbn: '9791194530701', title: '괴테는 모든 것을 말했다', author: '鈴木悠衣', publisher: '리프', tags: ['literature', 'classic', 'deep', 'art'] },
];

const FALLBACK_NOTICES = [
  {
    title: '북크닉 추첨 당첨자 발표',
    url: 'https://library.donga.ac.kr/community/notice/?pid=36700&ks=',
    author: '도서관',
    date: '2026.05.20',
    views: '',
    summary: '',
  },
  {
    title: '북스타그램 ‘랜덤가챠북’ 이벤트 안내',
    url: 'https://library.donga.ac.kr/community/notice/?pid=36674&ks=',
    author: '도서관',
    date: '2026.05.19',
    views: '',
    summary: '',
  },
  {
    title: '[학술DB] 윕스 서비스 일시 중단 안내 (5/22~25)',
    url: 'https://library.donga.ac.kr/community/notice/?pid=36426&ks=',
    author: '도서관',
    date: '2026.05.15',
    views: '',
    summary: '',
  },
  {
    title: '2026 전자정보 박람회 경품당첨자 발표',
    url: 'https://library.donga.ac.kr/community/notice/?pid=36545&ks=',
    author: '도서관',
    date: '2026.05.14',
    views: '',
    summary: '',
  },
  {
    title: '[월간 학술DB] ICPSR DB & KSDC DB (2026년 5월)',
    url: 'https://library.donga.ac.kr/community/notice/?pid=36571&ks=',
    author: '도서관',
    date: '2026.05.14',
    views: '',
    summary: '',
  },
];

const TAG_RULES = {
  easy: ['쉽게', '입문', '가볍', '처음', '청소년', '하루', '짧', '만화', '그림'],
  youth: ['청소년', '대학생', '새내기', '진로', '성장', '입문'],
  start: ['시작', '입문', '기초', '처음', '첫'],
  career: ['일', '직업', '커리어', '취업', '조직', '경영', '리더', '회사', '공무원', '경제'],
  identity: ['나', '자아', '정체성', '삶', '인생', '성장', '자기'],
  novel: ['소설', '장편', '단편', '문학', '시집', '이야기', '작품'],
  essay: ['에세이', '산문', '마음', '일상', '편지', '위로', '생각'],
  work: ['일', '업무', '조직', '경영', '노동', '기획', '직장'],
  relationship: ['관계', '사람', '대화', '가족', '사랑', '공감', '심리'],
  life: ['삶', '생활', '인생', '태도', '습관', '일상'],
  deep: ['철학', '사상', '고전', '역사', '정신', '문명', '이론', '비평'],
  classic: ['고전', '세계문학', '문학전집', '셰익스피어', '헤르만', '괴테', '데미안'],
  history: ['역사', '고대', '근대', '전쟁', '문명', '한국사', '세계사'],
  comfort: ['위로', '마음', '다정', '괜찮', '휴식', '불안', '상처'],
  healing: ['치유', '회복', '휴식', '위로', '다정', '평온'],
  knowledge: ['이해', '지식', '교양', '과학', '사회', '해설', '강의', '탐구'],
  science: ['과학', '우주', '물리', '생명', '의학', '뇌', '수학', '기술'],
  society: ['사회', '정치', '문화', '세상', '도시', '젠더', '불평등', '인류'],
  mind: ['마음', '심리', '생각', '불안', '감정', '정신'],
  philosophy: ['철학', '사유', '윤리', '정의', '인식', '존재'],
  fun: ['재미', '유쾌', '모험', '미스터리', '추리', '여행'],
  travel: ['여행', '도시', '세계', '길', '공간'],
  growth: ['성장', '자기계발', '습관', '태도', '성공', '도전', '역량'],
  challenge: ['도전', '변화', '혁신', '창업', '성취'],
  story: ['이야기', '서사', '소설', '장편', '인물', '사건'],
  mystery: ['추리', '미스터리', '스릴러', '범죄'],
  humanities: ['인문', '철학', '역사', '문학', '문화', '사상'],
  technology: ['AI', '인공지능', '기술', '디지털', '데이터', '로봇', '미래'],
  future: ['미래', 'AI', '기술', '변화', '트렌드', '혁신'],
  practical: ['실용', '방법', '가이드', '매뉴얼', '전략', '기술', '작성법'],
  short: ['짧', '하루', '에세이', '시집', '단편'],
  readable: ['쉽게', '재미', '이야기', '교양', '대중'],
  balanced: ['교양', '생각', '삶', '사회', '문학'],
  study: ['공부', '학습', '논문', '작성법', '전공', '매뉴얼', '강의'],
  psychology: ['심리', '마음', '감정', '관계', '뇌'],
  economy: ['경제', '돈', '투자', '시장', '자본', '경영'],
  art: ['예술', '미술', '음악', '디자인', '창작', '영화'],
  literature: ['문학', '시', '소설', '작가', '비평'],
  popular: ['대출횟수', '인기', '베스트', '추천'],
};

const TAG_LABELS = {
  easy: '부담 없이 읽기',
  comfort: '위로',
  healing: '회복',
  knowledge: '지식',
  science: '과학',
  society: '사회',
  novel: '문학',
  essay: '에세이',
  career: '일과 진로',
  deep: '깊은 사유',
  classic: '고전',
  technology: '기술과 미래',
  relationship: '관계',
  growth: '성장',
  art: '예술',
  history: '역사',
  popular: '동아인의 선택',
  readable: '잘 읽히는 책',
};

function json(statusCode, body, cacheControl = 'no-store') {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'cdn-cache-control': 'no-store',
      'netlify-cdn-cache-control': 'no-store',
      expires: '0',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
    body: JSON.stringify(body),
  };
}

function normalizeIsbn(value) {
  const isbn = String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return isbn.length === 10 || isbn.length === 13 ? isbn : '';
}

function isbn10To13(value) {
  const isbn = normalizeIsbn(value);
  if (isbn.length === 13) return isbn;
  if (isbn.length !== 10 || !/^\d{9}[\dX]$/.test(isbn)) return '';

  const body = `978${isbn.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    sum += Number.parseInt(body[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

function isbn13To10(value) {
  const isbn = normalizeIsbn(value);
  if (isbn.length === 10) return isbn;
  if (isbn.length !== 13 || !isbn.startsWith('978') || !/^\d{13}$/.test(isbn)) return '';

  const body = isbn.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    sum += Number.parseInt(body[i], 10) * (10 - i);
  }
  const checkValue = (11 - (sum % 11)) % 11;
  const check = checkValue === 10 ? 'X' : String(checkValue);
  return `${body}${check}`;
}

function isbnVariants(...values) {
  const variants = new Set();
  values.forEach(value => {
    const isbn = normalizeIsbn(value);
    if (!isbn) return;
    variants.add(isbn);
    const converted = isbn.length === 10 ? isbn10To13(isbn) : isbn13To10(isbn);
    if (converted) variants.add(converted);
  });
  return [...variants];
}

function hasSharedIsbn(book, entry) {
  const bookIsbns = isbnVariants(book && book.isbn13, book && book.isbn);
  if (!bookIsbns.length) return false;
  const entryIsbns = isbnVariants(entry && entry.isbn13, entry && entry.isbn);
  return entryIsbns.some(isbn => bookIsbns.includes(isbn));
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

function isBookLikeEntry(entry) {
  const text = [entry.title, entry.author, ...(entry.meta || [])].join(' ');
  return !/\[?비디오녹화자료\]?|DVD|Blu-ray|블루레이|녹음자료|오디오북|전자책|e-?book/i.test(text);
}

function isExamPrepBook(book) {
  const titleText = cleanText(book && book.title);
  const categoryText = cleanText(book && book.categoryName);
  const authorPublisherText = [book && book.author, book && book.publisher].map(cleanText).join(' ');
  const metaText = Array.isArray(book && book.meta) ? book.meta.map(cleanText).join(' ') : '';
  const exclusionText = [
    titleText,
    categoryText,
    authorPublisherText,
    metaText,
    cleanText(book && book.collection),
    cleanText(book && book.description),
  ].join(' ');
  const primaryText = [titleText, categoryText].join(' ');

  if (/만화|웹툰|그래픽\s*노블|그래픽노블|코믹스|comic|comics|manga|cartoon/i.test(exclusionText)) {
    return true;
  }

  if (/수험서|자격증|공무원|국가고시|고등학교참고서|중학교참고서|초등참고서|취업\/수험서/i.test(categoryText)) {
    return true;
  }

  if (/크믈레|맥잡기|Pacific\s*크믈레|퍼시픽학술국/i.test([titleText, authorPublisherText].join(' '))) {
    return true;
  }

  return /수험서|수험\s*대비|문제집|기출|모의고사|실전모의|봉투모의|수능|내신|대입|검정고시|국가고시|의사국가고시|간호사국가고시|약사국가고시|치과의사국가고시|공무원\s*(?:국어|영어|한국사|행정법|행정학|헌법|사회|과학|수학|기출|문제|모의)|공인중개사|임용고시|경찰공무원|소방공무원|PSAT|LEET|MEET|DEET|NCS|인적성|토익|TOEIC|토플|TOEFL|IELTS|텝스|TEPS|JLPT|HSK|한능검|한국사능력검정|컴활|정보처리기사|자격증|기사\s*(?:필기|실기)|세무사|회계사|노무사|감정평가사|변리사|법무사|행정사/i.test(primaryText);
}

function libraryCatalogSearchUrl(value, field = 'I') {
  const url = new URL(LIBRARY_CATALOG_URL);
  addCatalogSearchParams(url, value, field);
  return url.toString();
}

function addCatalogSearchParams(url, value, field = 'I') {
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
}

function libraryCatalogRestUrl(value, field = 'I') {
  const url = new URL(LIBRARY_CATALOG_REST_URL);
  addCatalogSearchParams(url, value, field);
  return url.toString();
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

function coverCandidates(...values) {
  const seen = new Set();
  const covers = [];
  const flattened = values.flatMap(value => (Array.isArray(value) ? value : [value]));
  for (const value of flattened) {
    const cover = String(value || '').replace(/&amp;/g, '&').trim();
    if (!cover || /thumb_book_175x246_none|book-default|no[_-]?image|placeholder/i.test(cover)) continue;
    if (seen.has(cover)) continue;
    seen.add(cover);
    covers.push(cover);
  }
  return covers;
}

function catalogUrlForEntry(entry) {
  if (entry && entry.catalogUrl && /record_id=\d+/i.test(entry.catalogUrl)) return entry.catalogUrl;
  const isbn = normalizeIsbn(entry && entry.isbn);
  if (isbn) return libraryCatalogSearchUrl(isbn, 'I');
  return libraryCatalogSearchUrl((entry && entry.title) || '', 'T');
}

function fieldFromInner(innerHtml, className) {
  const re = new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, 'i');
  const match = String(innerHtml || '').match(re);
  return cleanText(match ? match[1] : '');
}

function extractCatalogEntries(baseUrl, html, collection) {
  const entries = [];
  const seen = new Set();
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    const attrs = match[1];
    const hrefMatch = attrs.match(/\bhref=["']([^"']*record_id=\d+[^"']*)["']/i);
    if (!hrefMatch) continue;

    const nearby = String(html || '').slice(Math.max(0, match.index - 1400), match.index + match[0].length + 1800);
    const isbnMatch = attrs.match(/\bisbn=["']([^"']+)["']/i) || nearby.match(/\bisbn=["']([^"']+)["']/i);
    const isbn = normalizeIsbn(isbnMatch && isbnMatch[1]);
    const catalogUrl = normalizeCatalogDetailUrl(hrefMatch[1], baseUrl);
    const recordId = (catalogUrl.match(/record_id=(\d+)/i) || [])[1] || catalogUrl;
    const seenKey = isbn || recordId;
    if (seen.has(seenKey)) continue;

    const inner = match[2];
    const title = fieldFromInner(inner, 'book-info-subject') || fieldFromClass(nearby, 'item-subject') || cleanText(inner);
    if (!title) continue;
    seen.add(seenKey);

    const author = fieldFromInner(inner, 'book-info-name') || fieldFromClass(nearby, 'item-option-cell');
    const meta = [...String(`${inner}\n${nearby}`).matchAll(/<div\b[^>]*class=["'][^"']*\b(?:book-info-txt|item-option-cell)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
      .map(m => cleanText(m[1]))
      .filter(Boolean);
    const imageMatch = inner.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i) || nearby.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
    const cover = normalizeCoverUrl(imageMatch && imageMatch[1], baseUrl);

    entries.push({
      isbn,
      title,
      author,
      meta,
      cover,
      collection: collection.name,
      collectionKeys: [collection.key],
      collectionTags: collection.tags,
      catalogUrl,
      ranks: { [collection.key]: entries.length + 1 },
    });
  }
  return entries;
}

function extractPageLinks(baseUrl, html, maxPages) {
  if (maxPages <= 1) return [];
  const links = [];
  const seen = new Set([baseUrl]);
  for (const match of String(html || '').matchAll(/href=["']([^"']*page_number=\d+[^"']*)["']/gi)) {
    const url = new URL(match[1].replace(/&amp;/g, '&'), baseUrl).toString();
    if (!seen.has(url)) {
      seen.add(url);
      links.push(url);
    }
  }
  links.sort((a, b) => {
    const pageA = Number.parseInt(new URL(a).searchParams.get('page_number') || '9999', 10);
    const pageB = Number.parseInt(new URL(b).searchParams.get('page_number') || '9999', 10);
    return pageA - pageB;
  });
  return links.slice(0, maxPages - 1);
}

function fallbackLibraryPool() {
  return FALLBACK_ENTRIES.map((book, index) => ({
    isbn: book.isbn,
    title: book.title,
    author: book.author,
    meta: [book.publisher].filter(Boolean),
    collection: '추천 예비 컬렉션',
    collectionKeys: ['fallback', index < 5 ? 'popular' : 'recommend'],
    collectionTags: [...new Set(['readable', ...(book.tags || [])])],
    catalogUrl: libraryCatalogSearchUrl(book.isbn, 'I'),
    ranks: { fallback: index + 1 },
  }));
}

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function libraryPostsApiUrl(limit = 5) {
  const url = new URL(LIBRARY_POSTS_API_URL);
  url.searchParams.set('per_page', String(Math.min(20, Math.max(1, limit))));
  url.searchParams.set('_fields', 'id,link,title,date,modified');
  url.searchParams.set('_', String(Date.now()));
  return url.toString();
}

async function fetchText(url, options = {}) {
  const res = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'DongALibraryAIBookFinder/1.0',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    timeoutMs: options.timeoutMs,
  });
  if (!res.ok) throw new Error(`Library page failed ${res.status}: ${url}`);
  return res.text();
}

async function fetchJson(url, options = {}) {
  const res = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'DongALibraryAIBookFinder/1.0',
      accept: 'application/json,text/plain,*/*',
      'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache',
      pragma: 'no-cache',
    },
    timeoutMs: options.timeoutMs,
  });
  if (!res.ok) throw new Error(`Library JSON failed ${res.status}: ${url}`);
  return res.json();
}

async function fetchCollectionFirstPage(collection) {
  if (collection.restUrl) {
    try {
      const data = await fetchJson(collection.restUrl);
      const html = data && data.content && data.content.rendered ? data.content.rendered : '';
      if (html) return html;
    } catch (error) {
      console.warn('[Collection REST]', collection.key, error.message);
    }
  }
  return fetchText(collection.url);
}

function loadSnapshotPool() {
  if (snapshotPoolCache) return snapshotPoolCache;
  try {
    const entries = require('../data/library-pool.json');
    snapshotPoolCache = Array.isArray(entries)
      ? entries.filter(entry => entry && entry.catalogUrl && entry.title && entry.isbn && !isExamPrepBook(entry))
      : [];
  } catch (error) {
    console.warn('[Library snapshot]', error.message);
    snapshotPoolCache = [];
  }
  return snapshotPoolCache;
}

async function findCatalogDetails(entry) {
  const current = catalogUrlForEntry(entry);
  const entryCover = coverCandidates(entry && entry.cover)[0] || '';
  if (/record_id=\d+/i.test(current) && entryCover) {
    return { catalogUrl: current, cover: entryCover };
  }

  const isbn = normalizeIsbn(entry && entry.isbn);
  const value = isbn || cleanText(entry && entry.title);
  const field = isbn ? 'I' : 'T';
  if (!value) return { catalogUrl: current, cover: entryCover };

  try {
    const data = await fetchJson(libraryCatalogRestUrl(value, field));
    const html = data && data.content && data.content.rendered ? data.content.rendered : '';
    const holding = holdingFromCatalogHtml({ ...entry, isbn }, libraryCatalogSearchUrl(value, field), html, { key: 'catalog', name: '도서관 소장자료', tags: ['catalog'] }, {
      allowFirstResult: Boolean(isbn),
    });
    return {
      catalogUrl: holding && holding.catalogUrl ? holding.catalogUrl : current,
      cover: coverCandidates(holding && holding.cover, entryCover)[0] || '',
    };
  } catch (error) {
    console.warn('[Catalog detail URL]', value, error.message);
    return { catalogUrl: current, cover: entryCover };
  }
}

async function findCatalogDetailUrl(entry) {
  const details = await findCatalogDetails(entry);
  return details.catalogUrl;
}

async function buildLibraryPool() {
  if (poolCache && Date.now() - poolCache.savedAt < CACHE_TTL_MS) {
    return poolCache.entries;
  }

  const byIsbn = new Map();
  await Promise.all(COLLECTIONS.map(async (collection) => {
    try {
      const firstPage = await fetchCollectionFirstPage(collection);
      const pageUrls = [collection.url, ...extractPageLinks(collection.url, firstPage, COLLECTION_PAGE_LIMIT)];
      for (let i = 0; i < pageUrls.length; i += 1) {
        const page = i === 0 ? firstPage : await fetchText(pageUrls[i]);
        for (const entry of extractCatalogEntries(pageUrls[i], page, collection)) {
          const old = byIsbn.get(entry.isbn);
          if (!old) {
            byIsbn.set(entry.isbn, entry);
          } else {
            old.collection = old.collection.includes(entry.collection) ? old.collection : `${old.collection}, ${entry.collection}`;
            old.collectionKeys = [...new Set([...(old.collectionKeys || []), ...(entry.collectionKeys || [])])];
            old.collectionTags = [...new Set([...old.collectionTags, ...entry.collectionTags])];
            old.ranks = { ...(old.ranks || {}), ...(entry.ranks || {}) };
          }
        }
      }
    } catch (error) {
      console.warn('[Library collection]', collection.name, error.message);
    }
  }));

  const entries = [...byIsbn.values()].filter(entry => (
    entry.catalogUrl
    && entry.title
    && entry.isbn
    && isBookLikeEntry(entry)
    && !isExamPrepBook(entry)
  ));
  if (!entries.length) {
    const snapshot = loadSnapshotPool();
    if (snapshot.length) {
      console.warn('[Library collection] using bundled snapshot');
      poolCache = { savedAt: Date.now(), entries: snapshot };
      return poolCache.entries;
    }
    console.warn('[Library collection] using fallback entries');
    poolCache = { savedAt: Date.now(), entries: fallbackLibraryPool() };
    return poolCache.entries;
  }
  poolCache = { savedAt: Date.now(), entries };
  return entries;
}

function fieldFromClass(innerHtml, className) {
  const re = new RegExp(`<[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
  const match = String(innerHtml || '').match(re);
  return cleanText(match ? match[1] : '');
}

function firstTagWithClass(html, tagName, className) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*\\bclass=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, 'i');
  const match = String(html || '').match(pattern);
  return match ? match[0] : '';
}

function attrValue(tag, attrName) {
  const pattern = new RegExp(`\\b${attrName}=["']([^"']+)["']`, 'i');
  const match = String(tag || '').match(pattern);
  return match ? match[1] : '';
}

function communityNoticeUrl(value) {
  const url = new URL(String(value || LIBRARY_COMMUNITY_URL).replace(/&amp;/g, '&'), LIBRARY_COMMUNITY_URL);
  const pid = url.searchParams.get('pid');
  if (pid) {
    const canonical = new URL(LIBRARY_COMMUNITY_URL);
    canonical.searchParams.set('pid', pid);
    canonical.searchParams.set('ks', url.searchParams.get('ks') || '');
    return canonical.toString();
  }
  return url.toString();
}

function formatNoticeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value || '';
  const month = parts.find(part => part.type === 'month')?.value || '';
  const day = parts.find(part => part.type === 'day')?.value || '';
  return year && month && day ? `${year}.${month}.${day}` : '';
}

function extractCommunityNotices(html, limit) {
  const blocks = String(html || '').split(/<div\b[^>]*class=["'][^"']*\bboard-list-cell\b/i).slice(1);
  const notices = [];
  for (const rawBlock of blocks) {
    const block = `<div class="board-list-cell${rawBlock}`;
    if (/badge-list-notice/i.test(block)) continue;

    const linkTag = firstTagWithClass(block, 'a', 'btn-board-list-item');
    const href = attrValue(linkTag, 'href');
    const title = fieldFromClass(block, 'txt').replace(/\s+N$/, '');
    if (!href || !title) continue;

    const optionMatches = [...block.matchAll(/<div\b[^>]*class=["'][^"']*\bitem-option-cell\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
      .map(match => cleanText(match[1]));
    const summary = fieldFromClass(block, 'item-info');
    notices.push({
      title,
      url: communityNoticeUrl(href),
      author: optionMatches[0] || '',
      date: optionMatches[1] || '',
      views: optionMatches[2] || '',
      summary,
    });
    if (notices.length >= limit) break;
  }
  return notices;
}

function extractFeedNotices(xml, limit) {
  const items = String(xml || '').split(/<item\b[^>]*>/i).slice(1);
  const notices = [];
  for (const item of items) {
    const title = cleanText((item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) || item.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
    const link = cleanText((item.match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>/i) || item.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]);
    const pubDate = cleanText((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1]);
    if (!title || !link) continue;
    notices.push({
      title,
      url: communityNoticeUrl(link),
      author: '도서관',
      date: formatNoticeDate(pubDate),
      views: '',
      summary: '',
    });
    if (notices.length >= limit) break;
  }
  return notices;
}

function rememberNotices(notices, source) {
  lastNoticeSource = source;
  noticeCache = { savedAt: Date.now(), items: notices, source };
  return notices;
}

async function fetchCommunityNotices(limit = 5, options = {}) {
  if (!options.fresh && noticeCache && Date.now() - noticeCache.savedAt < NOTICE_CACHE_TTL_MS) {
    lastNoticeSource = noticeCache.source ? `cache:${noticeCache.source}` : 'cache';
    return noticeCache.items.slice(0, limit);
  }

  try {
    const feed = await fetchText(LIBRARY_FEED_URL, { timeoutMs: NOTICE_FETCH_TIMEOUT_MS });
    const notices = extractFeedNotices(feed, limit);
    if (notices.length) {
      return rememberNotices(notices, 'rss');
    }
  } catch (error) {
    console.warn('[Library notices feed]', error.message);
  }

  if (options.fastFallback !== false) {
    const fallback = FALLBACK_NOTICES.slice(0, limit);
    return rememberNotices(fallback, 'snapshot');
  }

  try {
    const posts = await fetchJson(libraryPostsApiUrl(Math.max(limit, 8)), { timeoutMs: NOTICE_FETCH_TIMEOUT_MS });
    const notices = (Array.isArray(posts) ? posts : [])
      .map(post => ({
        title: cleanText(post && post.title && post.title.rendered),
        url: post && post.id ? communityNoticeUrl(`${LIBRARY_COMMUNITY_URL}?pid=${post.id}&ks=`) : communityNoticeUrl(post && post.link),
        author: '도서관',
        date: post && post.date ? String(post.date).slice(0, 10).replace(/-/g, '.') : '',
        views: '',
        summary: '',
      }))
      .filter(notice => notice.title)
      .slice(0, limit);
    if (notices.length) {
      return rememberNotices(notices, 'api');
    }
  } catch (error) {
    console.warn('[Library notices API]', error.message);
  }

  try {
    const html = await fetchText(LIBRARY_COMMUNITY_URL, { timeoutMs: NOTICE_FETCH_TIMEOUT_MS });
    const notices = extractCommunityNotices(html, limit);
    if (notices.length) {
      return rememberNotices(notices, 'html');
    }
  } catch (error) {
    console.warn('[Library notices HTML]', error.message);
  }

  return [];
}

async function fetchCommunityNoticeResult(limit = 5, options = {}) {
  lastNoticeSource = '';
  const notices = await fetchCommunityNotices(limit, options);
  return {
    notices,
    source: lastNoticeSource || 'empty',
    isLive: ['rss', 'api', 'html'].includes(lastNoticeSource),
  };
}

function stableNumber(...parts) {
  return Number.parseInt(crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12), 16);
}

function stableFloat(...parts) {
  return (stableNumber(...parts) % 1000000) / 1000000;
}

function getAnswerTags(answers) {
  const tags = [];
  for (const answer of answers || []) {
    const choice = answer && answer.choice;
    if (choice && Array.isArray(choice.tags)) tags.push(...choice.tags);
  }
  return tags.filter(Boolean);
}

function scoreText(text, tags) {
  const haystack = String(text || '').toLowerCase();
  let score = 0;
  const matched = new Set();
  for (const tag of tags) {
    const keywords = TAG_RULES[tag] || [];
    for (const keyword of keywords) {
      if (haystack.includes(String(keyword).toLowerCase())) {
        score += 4;
        matched.add(tag);
        break;
      }
    }
  }
  return { score, matched };
}

function scoreLibraryEntry(entry, tags, seed) {
  const text = [entry.title, entry.author, entry.meta.join(' '), entry.collection, entry.collectionTags.join(' ')].join(' ');
  const { score, matched } = scoreText(text, tags);
  for (const tag of entry.collectionTags || []) {
    if (tags.includes(tag)) matched.add(tag);
  }
  const keyBoost =
    (entry.collectionKeys || []).includes('recommend') ? 3 :
    (entry.collectionKeys || []).includes('monthly') ? 2.8 :
    (entry.collectionKeys || []).includes('classic') ? 2.4 :
    (entry.collectionKeys || []).includes('popular') ? 2 :
    (entry.collectionKeys || []).includes('new') ? 1.8 : 1;
  const matchCoverage = matched.size ? Math.min(6, matched.size * 1.5) : 0;
  const jitter = stableFloat(seed, entry.isbn) * 5;
  return { score: score + keyBoost + matchCoverage + jitter, matched: [...matched] };
}

async function lookupAladin(ttbKey, isbn) {
  if (!ttbKey) return null;
  const url = new URL(ALADIN_LOOKUP_URL);
  url.searchParams.set('ttbkey', ttbKey);
  url.searchParams.set('ItemId', isbn);
  url.searchParams.set('ItemIdType', isbn.length === 13 ? 'ISBN13' : 'ISBN');
  url.searchParams.set('Cover', 'Big');
  url.searchParams.set('OptResult', 'fulldescription,fulldescription2,Toc,Story,authors');
  url.searchParams.set('output', 'js');
  url.searchParams.set('Version', '20131101');

  const res = await fetchWithTimeout(url, { timeoutMs: ALADIN_LOOKUP_TIMEOUT_MS });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Aladin lookup failed ${res.status}`);
  const data = JSON.parse(raw);
  if (data.errorCode) return null;
  return (data.item || [])[0] || null;
}

function collectTextValues(value) {
  if (Array.isArray(value)) return value.flatMap(collectTextValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectTextValues);
  return value == null ? [] : [cleanText(value)];
}

function labeledAladinPart(label, value, minLength = 20) {
  const text = collectTextValues(value)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < minLength) return '';
  return `${label}\n${text}`;
}

function combineDescriptionParts(parts, maxLength = 1400) {
  const combined = [];
  parts.map(cleanText).filter(Boolean).forEach(text => {
    const duplicateIndex = combined.findIndex(part => part.includes(text) || text.includes(part));
    if (duplicateIndex === -1) {
      combined.push(text);
    } else if (text.length > combined[duplicateIndex].length) {
      combined[duplicateIndex] = text;
    }
  });

  let result = '';
  for (const part of combined) {
    const next = result ? `${result}\n\n${part}` : part;
    if (next.length > maxLength) {
      if (!result) return `${part.slice(0, maxLength).trim()}...`;
      break;
    }
    result = next;
  }
  return result;
}

function aladinDescription(item) {
  const subInfo = item && item.subInfo ? item.subInfo : {};
  const mainDescription = combineDescriptionParts([
    item && item.fullDescription2,
    item && item.fullDescription,
    item && item.description,
  ], 900);

  const supplementary = [
    labeledAladinPart('책 소개 보강', subInfo.bookinfo || subInfo.bookInfo || subInfo.itemDescription),
    labeledAladinPart('목차', subInfo.toc || subInfo.Toc, 30),
    labeledAladinPart('책 속에서', subInfo.story || subInfo.Story, 30),
    labeledAladinPart('저자 소개', subInfo.authors || subInfo.authorInfo, 40),
  ];

  return combineDescriptionParts([mainDescription, ...supplementary], 1400);
}

function largerAladinCover(url) {
  return String(url || '')
    .replace(/\/cover\d*\//i, '/cover500/')
    .replace(/\/cover\//i, '/cover500/');
}

function normalizeAladinImageUrl(value) {
  const url = String(value || '')
    .replace(/\\\//g, '/')
    .replace(/^\/\//, 'https://')
    .replace(/^http:\/\//i, 'https://')
    .replace(/&amp;/g, '&')
    .trim();
  if (!/^https:\/\/image\.aladin\.co\.kr\/product\//i.test(url)) return '';
  if (!/\/cover\d*\//i.test(url) && !/\/cover\//i.test(url)) return '';
  if (!/\.(jpe?g|png|webp)(\?|$)/i.test(url)) return '';
  return largerAladinCover(url);
}

function isAladinCoverUrl(value) {
  return /^https:\/\/image\.aladin\.co\.kr\/product\//i.test(String(value || ''));
}

function extractAladinCover(html) {
  const source = String(html || '');
  const priorityPatterns = [
    /<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i,
    /<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i,
    /<img\b[^>]*\bid=["'](?:CoverMainImage|mainCoverImg)["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/i,
    /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*\bid=["'](?:CoverMainImage|mainCoverImg)["'][^>]*>/i,
    /["']image["']\s*:\s*["']([^"']+)["']/i,
  ];

  for (const pattern of priorityPatterns) {
    const cover = normalizeAladinImageUrl((source.match(pattern) || [])[1]);
    if (cover) return cover;
  }

  const urls = [...source.matchAll(/(?:https?:)?\/\/image\.aladin\.co\.kr\/product\/[^"'\s<>),]+/gi)]
    .map(match => normalizeAladinImageUrl(match[0]))
    .filter(Boolean);
  return urls.length ? urls[0] : '';
}

function aladinProductUrlForIsbn(isbn) {
  const url = new URL(ALADIN_PRODUCT_URL);
  url.searchParams.set('ISBN', isbn);
  return url.toString();
}

function extractAladinProductLinks(html, baseUrl = ALADIN_SEARCH_URL) {
  const seen = new Set();
  const links = [];
  const source = String(html || '').replace(/&amp;/g, '&');
  for (const match of source.matchAll(/href=["']([^"']*\/shop\/wproduct\.aspx\?[^"']*(?:ItemId|ISBN|isbn)=[^"']+)["']/gi)) {
    try {
      const link = new URL(match[1], baseUrl).toString();
      if (!seen.has(link)) {
        seen.add(link);
        links.push({ link, index: match.index || 0 });
      }
    } catch (_) {
      // Ignore malformed third-party markup in Aladin search pages.
    }
  }
  return links;
}

function extractCanonicalAladinLink(html, fallbackUrl = '') {
  const canonical = (String(html || '').match(/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i) || [])[1];
  if (!canonical) return fallbackUrl;
  try {
    return new URL(canonical.replace(/&amp;/g, '&'), ALADIN_PRODUCT_URL).toString();
  } catch (_) {
    return fallbackUrl;
  }
}

async function lookupAladinProductPage(url) {
  if (!url) return { cover: '', link: '' };
  const res = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'DongALibraryAIBookFinder/1.0',
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    timeoutMs: ALADIN_LOOKUP_TIMEOUT_MS,
  });
  if (!res.ok) return { cover: '', link: '' };
  const html = await res.text();
  const cover = extractAladinCover(html);
  return {
    cover,
    link: cover ? extractCanonicalAladinLink(html, url) : '',
  };
}

async function lookupAladinWebInfo(query) {
  const cleanQuery = cleanText(query);
  if (!cleanQuery) return { cover: '', link: '' };
  const isbn = normalizeIsbn(cleanQuery);
  if (isbn) {
    const productInfo = await lookupAladinProductPage(aladinProductUrlForIsbn(isbn));
    if (productInfo.cover) return productInfo;
    return { cover: '', link: '' };
  }

  const url = new URL(ALADIN_SEARCH_URL);
  url.searchParams.set('SearchTarget', 'Book');
  url.searchParams.set('SearchWord', cleanQuery);

  const res = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'DongALibraryAIBookFinder/1.0',
      accept: 'text/html,application/xhtml+xml',
    },
    timeoutMs: ALADIN_LOOKUP_TIMEOUT_MS,
  });
  if (!res.ok) return { cover: '', link: '' };
  const html = await res.text();
  if (/검색 결과가 없습니다|no search results/i.test(cleanText(html))) return { cover: '', link: '' };
  const productLinks = extractAladinProductLinks(html, url.toString());
  if (!productLinks.length) return { cover: '', link: '' };

  for (const product of productLinks.slice(0, 3)) {
    const nearby = html.slice(Math.max(0, product.index - 1800), product.index + 2600);
    const cover = extractAladinCover(nearby);
    if (cover) return { cover, link: product.link };
  }

  return lookupAladinProductPage(productLinks[0].link);
}

async function lookupBookInfo(ttbKey, isbn, title = '') {
  let item = null;
  const lookupIds = isbnVariants(isbn);
  for (const lookupId of lookupIds) {
    try {
      const candidate = await lookupAladin(ttbKey, lookupId);
      if (!candidate) continue;
      item = item || candidate;
      if (candidate.cover) {
        return {
          item: candidate,
          cover: largerAladinCover(candidate.cover),
          link: candidate.link || '',
        };
      }
    } catch (error) {
      console.warn('[Aladin lookup]', lookupId, error.message);
    }
  }

  if (item && item.link) {
    try {
      const productInfo = await lookupAladinProductPage(item.link);
      if (productInfo.cover) return { item, ...productInfo };
    } catch (error) {
      console.warn('[Aladin product cover]', item.link, error.message);
    }
  }

  try {
    const queries = lookupIds.length
      ? lookupIds
      : coverCandidates(titleSearchQueries(title), title);
    let foundLink = item && item.link ? item.link : '';
    for (const query of queries) {
      const webInfo = await lookupAladinWebInfo(query);
      foundLink = foundLink || webInfo.link;
      if (webInfo.cover) return { item, cover: webInfo.cover, link: webInfo.link || foundLink };
    }
    return { item, cover: '', link: foundLink };
  } catch (error) {
    console.warn('[Aladin web cover]', isbn, error.message);
    return { item, cover: '', link: item && item.link ? item.link : '' };
  }
}

function comparableTitle(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleParts(value) {
  const raw = cleanText(value);
  if (!raw) return [];

  const withoutBracketed = raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const firstRaw = raw.split(/\s+(?:-|–|—|―)\s+|[:：|]/)[0];
  const firstWithoutBracketed = withoutBracketed.split(/\s+(?:-|–|—|―)\s+|[:：|]/)[0];

  return [...new Set([raw, withoutBracketed, firstRaw, firstWithoutBracketed]
    .map(part => cleanText(part))
    .filter(part => part && part.length >= 2))];
}

function titleBases(value) {
  return [...new Set(titleParts(value)
    .map(part => comparableTitle(part))
    .filter(part => part && part.length >= 2))];
}

function titleSearchQueries(value) {
  return titleParts(value).slice(0, 2);
}

function titlesMatch(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 4 && longer.includes(shorter);
}

function selectHolding(book, entries) {
  const exact = entries.find(entry => hasSharedIsbn(book, entry));
  if (exact) return exact;

  const bookTitles = titleBases(book.title);
  if (!bookTitles.length) return null;
  return entries.find(entry => {
    const entryTitles = titleBases(entry.title);
    return bookTitles.some(title => entryTitles.some(entryTitle => titlesMatch(title, entryTitle)));
  }) || null;
}

function holdingFromCatalogHtml(book, url, html, collection, options = {}) {
  const entries = extractCatalogEntries(url, html, collection);
  const selected = selectHolding(book, entries) || (options.allowFirstResult ? entries[0] : null);
  if (selected) return selected;

  if (!options.allowFirstResult) return null;

  const hasRecord = /record_id=\d+/i.test(String(html || ''));
  const isbn = isbnVariants(book.isbn13, book.isbn)[0] || '';
  const isbnMatches = isbnVariants(book.isbn13, book.isbn).some(value => String(html || '').includes(value));
  if (!hasRecord || !isbnMatches) return null;

  const recordMatch = String(html || '').match(/href=["']([^"']*record_id=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
  const href = recordMatch && recordMatch[1] ? recordMatch[1] : url;
  const title = cleanText(recordMatch && recordMatch[2]) || cleanText(book.title);
  if (!title) return null;

  return {
    isbn,
    title,
    author: '',
    meta: [],
    collection: collection.name,
    collectionKeys: [collection.key],
    collectionTags: collection.tags,
    catalogUrl: normalizeCatalogDetailUrl(href, url),
    ranks: { [collection.key]: 1 },
  };
}

async function findLibraryHoldingStatus(book, pool, options = {}) {
  const includeTitleSearch = options.includeTitleSearch !== false;

  if (options.useLocalPool !== false) {
    const local = selectHolding(book, pool);
    if (local) return { holding: local, checked: true };
  }

  const collection = { key: 'catalog', name: '도서관 소장자료', tags: ['catalog'] };
  const searches = [];
  const isbns = isbnVariants(book.isbn13, book.isbn);
  const isbnSearchLimit = Number.parseInt(options.isbnSearchLimit || String(isbns.length), 10) || isbns.length;
  isbns.slice(0, isbnSearchLimit).forEach(isbn => {
    searches.push({ value: isbn, field: 'I', allowFirstResult: true });
  });
  if (includeTitleSearch) {
    titleSearchQueries(book.title).forEach(title => {
      searches.push({ value: title, field: 'T', allowFirstResult: false });
    });
  }

  const seen = new Set();
  let attempted = 0;
  let completed = 0;
  for (const search of searches) {
    const key = `${search.field}:${search.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    attempted += 1;

    try {
      const url = libraryCatalogSearchUrl(search.value, search.field);
      const html = await fetchText(url, { timeoutMs: options.fetchTimeoutMs });
      completed += 1;
      const holding = holdingFromCatalogHtml(book, url, html, collection, {
        allowFirstResult: search.allowFirstResult,
      });
      if (holding) return { holding, checked: true };
    } catch (error) {
      console.warn('[Library catalog holding]', search.value, error.message);
    }
  }
  return { holding: null, checked: attempted > 0 && completed > 0 };
}

async function findLibraryHolding(book, pool, options = {}) {
  const status = await findLibraryHoldingStatus(book, pool, options);
  return status.holding;
}

async function fetchAladinBestSellers(pool, limit = 6) {
  const ttbKey = process.env.ALADIN_TTB_KEY || '';
  if (!ttbKey) return [];
  if (bestSellerCache && Date.now() - bestSellerCache.savedAt < BESTSELLER_CACHE_TTL_MS) {
    return bestSellerCache.items.slice(0, limit);
  }

  try {
    const url = new URL(ALADIN_ITEM_LIST_URL);
    url.searchParams.set('ttbkey', ttbKey);
    url.searchParams.set('QueryType', 'Bestseller');
    url.searchParams.set('SearchTarget', 'Book');
    url.searchParams.set('MaxResults', String(Math.min(20, Math.max(limit * 3, 10))));
    url.searchParams.set('Cover', 'Big');
    url.searchParams.set('output', 'js');
    url.searchParams.set('Version', '20131101');

    const res = await fetchWithTimeout(url);
    const raw = await res.text();
    if (!res.ok) throw new Error(`Aladin bestseller failed ${res.status}`);
    const data = JSON.parse(raw);
    if (data.errorCode) throw new Error(data.errorMessage || data.errorCode);

    const books = (Array.isArray(data.item) ? data.item : [])
      .filter(item => !isExamPrepBook(item))
      .slice(0, limit);
    const checked = books.map((item, index) => {
        const isbn = normalizeIsbn(item.isbn13 || item.isbn);
        const fallbackCatalogUrl = catalogUrlForEntry({ isbn, title: item.title });
        return {
          rank: index + 1,
          title: cleanText(item.title),
          author: cleanText(item.author),
          publisher: cleanText(item.publisher),
          cover: largerAladinCover(item.cover || ''),
          link: item.link || '',
          isbn,
          isOwned: false,
          holdingChecked: false,
          libraryCatalogUrl: '',
          catalogSearchUrl: fallbackCatalogUrl,
          requestUrl: PURCHASE_REQUEST_URL,
          actionLabel: '도서관 확인 중',
          actionUrl: fallbackCatalogUrl,
        };
      });
    const items = checked
      .filter(book => book.title)
      .slice(0, limit);
    bestSellerCache = { savedAt: Date.now(), items };
    return items;
  } catch (error) {
    console.warn('[Aladin bestsellers]', error.message);
    if (bestSellerCache) return bestSellerCache.items.slice(0, limit);
    return [];
  }
}

async function enrichCandidates(candidates, tags, maxResults, seed, options = {}) {
  const ttbKey = process.env.ALADIN_TTB_KEY || '';
  const enriched = [];
  const fallbackLimit = tags.includes('popular') ? POPULAR_ENRICH_LOOKUP_LIMIT : MAIN_ENRICH_LOOKUP_LIMIT;
  const requestedLimit = Number.parseInt(options.lookupLimit || fallbackLimit, 10) || fallbackLimit;
  const maxLookups = Math.min(candidates.length, Math.max(maxResults, requestedLimit));
  const fallbackCandidateLimit = tags.includes('popular') ? maxLookups : MAIN_CANDIDATE_POOL_LIMIT;
  const requestedCandidateLimit = Number.parseInt(options.candidateLimit || fallbackCandidateLimit, 10) || fallbackCandidateLimit;
  const maxCandidates = Math.min(candidates.length, Math.max(maxLookups, requestedCandidateLimit));
  const selected = candidates.slice(0, maxCandidates);
  const batchSize = ttbKey ? 6 : 5;

  for (let start = 0; start < selected.length; start += batchSize) {
    const batch = selected.slice(start, start + batchSize);
    const lookedUp = await Promise.all(batch.map(async ({ entry, initial }, index) => {
      if (start + index >= maxLookups) {
        const covers = coverCandidates(entry.cover);
        return {
          entry,
          initial,
          item: null,
          cover: covers[0] || '',
          coverFallbacks: covers.slice(1),
          detailUrl: catalogUrlForEntry(entry),
          aladinLink: '',
        };
      }
      const [info, catalogDetails] = await Promise.all([
        lookupBookInfo(ttbKey, entry.isbn, entry.title).catch(error => {
          console.warn('[Aladin info]', entry.isbn, error.message);
          return { item: null, cover: '', link: '' };
        }),
        findCatalogDetails(entry).catch(error => {
          console.warn('[Catalog detail URL]', entry.isbn, error.message);
          return { catalogUrl: catalogUrlForEntry(entry), cover: entry.cover || '' };
        }),
      ]);
      const covers = coverCandidates(info.cover, catalogDetails.cover, entry.cover, info.item && info.item.cover);
      return {
        entry,
        initial,
        item: info.item,
        cover: covers[0] || '',
        coverFallbacks: covers.slice(1),
        detailUrl: catalogDetails.catalogUrl,
        aladinLink: info.link || '',
      };
    }));

    for (const { entry, initial, item, cover, coverFallbacks, detailUrl, aladinLink } of lookedUp) {
      if (isExamPrepBook(entry) || isExamPrepBook(item)) continue;
      const text = [
        entry.title,
        entry.author,
        entry.meta.join(' '),
        entry.collection,
        item && item.title,
        item && item.author,
        item && item.publisher,
        item && item.categoryName,
        aladinDescription(item),
      ].join(' ');
      const enrichedScore = scoreText(text, tags);
      const matchedTags = [...new Set([...initial.matched, ...enrichedScore.matched])];
      const categoryBonus = item && item.categoryName ? 1.2 : 0;
      const itemDescription = aladinDescription(item);
      const descriptionBonus = itemDescription ? Math.min(2.5, itemDescription.length / 180) : 0;
      enriched.push({
        title: entry.title,
        author: cleanText(entry.author || (item && item.author) || ''),
        publisher: cleanText((item && item.publisher) || ''),
        description: itemDescription,
        cover,
        coverFallbacks,
        link: (item && item.link) || aladinLink || '',
        isbn: entry.isbn,
        collection: entry.collection,
        collectionKeys: entry.collectionKeys || [],
        libraryCatalogUrl: detailUrl || catalogUrlForEntry(entry),
        matchedTags,
        score: initial.score + enrichedScore.score + categoryBonus + descriptionBonus + (item ? 2 : 0) + (cover ? 3 : 0) + stableFloat(seed, 'enriched', entry.isbn) * 2,
      });
    }
  }

  return enriched.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'ko'));
}

function chooseDiverse(items, limit, seed, excludeIsbns = new Set(), options = {}) {
  const selected = [];
  const collectionCaps = options.collectionCaps || {};
  const coverPenalty = Number.parseFloat(options.coverPenalty || '0') || 0;
  const remaining = items.filter(item => item && item.isbn && !excludeIsbns.has(item.isbn));
  while (selected.length < limit && remaining.length) {
    const slotsLeft = limit - selected.length;
    const coverReady = remaining.filter(item => item.cover);
    const rankSource = options.preferCover && coverReady.length >= slotsLeft ? coverReady : remaining;
    const rankedWithCaps = rankSource
      .map(item => {
        const primaryCollection = item.collectionKeys?.[0] || '';
        const sameAuthor = selected.some(old => old.author && item.author && old.author === item.author);
        const samePrimaryCollection = selected.filter(old => old.collectionKeys?.[0] && old.collectionKeys?.[0] === primaryCollection).length;
        const tagOverlap = selected.some(old => (old.matchedTags || []).some(tag => (item.matchedTags || []).includes(tag)));
        const cappedCollection = primaryCollection && collectionCaps[primaryCollection] && samePrimaryCollection >= collectionCaps[primaryCollection];
        const penalty = (sameAuthor ? 8 : 0) + (samePrimaryCollection >= 2 ? 5 : 0) + (tagOverlap && selected.length > 2 ? 1.6 : 0) + (!item.cover ? coverPenalty : 0);
        const variation = stableFloat(seed, 'pick', selected.length, item.isbn) * 7;
        return { item, adjusted: item.score - penalty + variation, cappedCollection };
      })
      .sort((a, b) => b.adjusted - a.adjusted);
    const uncapped = rankedWithCaps.filter(entry => !entry.cappedCollection);
    const ranked = uncapped.length ? uncapped : rankedWithCaps;

    const windowSize = Math.min(7, ranked.length);
    const pickIndex = Math.floor(stableFloat(seed, 'window', selected.length) * windowSize);
    const picked = ranked[pickIndex].item;
    selected.push(picked);
    remaining.splice(remaining.findIndex(item => item.isbn === picked.isbn), 1);
  }
  return selected;
}

function popularCandidateEntries(pool, excludeIsbns, seed) {
  const preferred = pool.filter(entry => (entry.collectionKeys || []).includes('popular') && !isExamPrepBook(entry));
  const source = preferred.length
    ? preferred
    : [
        ...pool.filter(entry => !excludeIsbns.has(entry.isbn) && !isExamPrepBook(entry)),
        ...fallbackLibraryPool().filter(entry => !excludeIsbns.has(entry.isbn) && !isExamPrepBook(entry)),
      ];
  const seen = new Set();
  return source
    .filter(entry => {
      if (!entry || !entry.isbn || excludeIsbns.has(entry.isbn) || seen.has(entry.isbn) || isExamPrepBook(entry)) return false;
      seen.add(entry.isbn);
      return true;
    })
    .map(entry => {
      const rank = entry.ranks && entry.ranks.popular ? entry.ranks.popular : 99;
      const preferredBoost = (entry.collectionKeys || []).includes('popular') ? 12 : 0;
      const readableBoost = (entry.collectionTags || []).includes('readable') ? 4 : 0;
      return {
        entry,
        initial: {
          score: preferredBoost + readableBoost + 42 - Math.min(rank, 40) * 0.45 + stableFloat(seed, 'popular', entry.isbn) * 5,
          matched: ['popular', 'readable'],
        },
      };
    })
    .sort((a, b) => b.initial.score - a.initial.score)
    .slice(0, 16);
}

function bookFromLibraryEntry(entry, matchedTags = ['동아인의 선택', '인기도서']) {
  if (isExamPrepBook(entry)) return null;
  const libraryCovers = coverCandidates(entry.cover);
  const book = {
    title: entry.title,
    author: cleanText(entry.author || ''),
    publisher: cleanText((entry.meta || [])[0] || ''),
    description: '',
    cover: '',
    coverFallbacks: libraryCovers,
    link: '',
    isbn: entry.isbn,
    collection: entry.collection,
    collectionKeys: entry.collectionKeys || [],
    libraryCatalogUrl: catalogUrlForEntry(entry),
    matchedTags,
    score: 0,
  };
  book.description = makeBookDescription(book);
  return book;
}

async function ensureAladinCover(book) {
  if (!book || !book.isbn || isExamPrepBook(book)) return book;
  if (isAladinCoverUrl(book.cover)) return book;
  try {
    const [info, catalogDetails] = await Promise.all([
      lookupBookInfo(process.env.ALADIN_TTB_KEY || '', book.isbn, book.title),
      findCatalogDetails(book).catch(error => {
        console.warn('[Popular library cover]', book.isbn, error.message);
        return { catalogUrl: book.libraryCatalogUrl || catalogUrlForEntry(book), cover: '' };
      }),
    ]);
    const item = info && info.item;
    const covers = coverCandidates(
      info && info.cover,
      catalogDetails && catalogDetails.cover,
      book.cover,
      book.coverFallbacks,
      item && item.cover
    );
    return {
      ...book,
      author: book.author || cleanText(item && item.author),
      publisher: book.publisher || cleanText(item && item.publisher),
      description: book.description || aladinDescription(item),
      cover: covers[0] || '',
      coverFallbacks: covers.slice(1),
      link: book.link || (item && item.link) || (info && info.link) || '',
      libraryCatalogUrl: book.libraryCatalogUrl || (catalogDetails && catalogDetails.catalogUrl) || '',
    };
  } catch (error) {
    console.warn('[Popular cover]', book.isbn, error.message);
    return book;
  }
}

async function fillMainCovers(items, minCoverCount) {
  if (!MAIN_EXTRA_COVER_LOOKUP_LIMIT || !Array.isArray(items)) return items;
  let coverCount = items.filter(book => book && book.cover).length;
  if (coverCount >= minCoverCount) return items;

  const updated = new Map(items.map(book => [book.isbn, book]));
  const targets = items
    .filter(book => book && book.isbn && !book.cover)
    .slice(0, MAIN_EXTRA_COVER_LOOKUP_LIMIT);
  const batchSize = 4;

  for (let start = 0; start < targets.length && coverCount < minCoverCount; start += batchSize) {
    const batch = targets.slice(start, start + batchSize);
    const lookedUp = await Promise.all(batch.map(ensureAladinCover));
    lookedUp.forEach(book => {
      if (!book || !book.isbn) return;
      const before = updated.get(book.isbn);
      if (!before || before.cover) return;
      updated.set(book.isbn, book);
      if (book.cover) coverCount += 1;
    });
  }

  return items.map(book => updated.get(book.isbn) || book);
}

async function fillPopularItems(items, popularCandidates, limit) {
  const filled = items.filter(item => !isExamPrepBook(item));
  const seen = new Set(filled.map(item => item && item.isbn).filter(Boolean));
  for (const candidate of popularCandidates) {
    if (filled.length >= limit) break;
    const entry = candidate && candidate.entry;
    if (!entry || !entry.isbn || seen.has(entry.isbn) || isExamPrepBook(entry)) continue;
    seen.add(entry.isbn);
    const book = bookFromLibraryEntry(entry);
    if (book) filled.push(book);
  }
  if (filled.length < limit) {
    for (const entry of fallbackLibraryPool()) {
      if (filled.length >= limit) break;
      if (!entry.isbn || seen.has(entry.isbn) || isExamPrepBook(entry)) continue;
      seen.add(entry.isbn);
      const book = bookFromLibraryEntry(entry);
      if (book) filled.push(book);
    }
  }
  return Promise.all(filled.slice(0, limit).map((book, index) => (
    index < POPULAR_COVER_LOOKUP_LIMIT ? ensureAladinCover(book) : book
  )));
}

function makeBookDescription(book) {
  const original = cleanText(book.description || '');
  const metaText = [book.author, book.publisher, book.collection].filter(Boolean).join(', ');
  if (original) return original.length > 900 ? `${original.slice(0, 900).trim()}...` : original;
  return `${book.title || '이 책'}은 ${metaText ? `${metaText} 정보로 확인되는 ` : ''}추천 도서입니다. 알라딘 API에서 긴 책 소개가 제공되지 않아, 현재 화면에는 도서관 서지 정보와 추천 분석 결과를 우선 표시합니다.`;
}

function makeShelfTitle(tags) {
  if (tags.includes('comfort') || tags.includes('healing')) return '잠시 숨을 고르는 책';
  if (tags.includes('technology') || tags.includes('future')) return '다가올 세계를 읽는 책';
  if (tags.includes('career') || tags.includes('growth')) return '다시 움직이게 하는 책';
  if (tags.includes('deep') || tags.includes('classic')) return '오래 생각이 머무는 책';
  if (tags.includes('novel') || tags.includes('story')) return '이야기 안쪽으로 들어가는 책';
  return '오늘의 관심사와 맞닿은 책';
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const payload = JSON.parse(event.body || '{}');
    const answers = Array.isArray(payload.answers) ? payload.answers : [];
    const limit = Math.min(10, Math.max(3, Number.parseInt(payload.limit || '6', 10) || 6));
    const popularLimit = Math.min(8, Math.max(3, Number.parseInt(payload.popularLimit || '5', 10) || 5));
    const tags = getAnswerTags(answers);
    if (answers.length < 1 || tags.length < 1) {
      return json(400, { error: 'Answers are required.' });
    }

    const pool = await buildLibraryPool();
    if (!pool.length) {
      return json(502, { error: 'No library books could be collected.' });
    }

    const clientSeed = String(payload.seed || crypto.randomUUID());
    const dateKey = new Date().toISOString().slice(0, 10);
    const seed = `${API_VERSION}:${dateKey}:${clientSeed}:${tags.join(',')}`;
    const candidates = pool
      .filter(entry => !isExamPrepBook(entry))
      .map(entry => ({ entry, initial: scoreLibraryEntry(entry, tags, seed) }))
      .sort((a, b) => b.initial.score - a.initial.score)
      .slice(0, 110);

    const enriched = await fillMainCovers(await enrichCandidates(candidates, tags, limit, seed), limit);
    const chosenItems = chooseDiverse(enriched, limit, seed, new Set(), { collectionCaps: MAIN_COLLECTION_CAPS, coverPenalty: 18, preferCover: true });
    const items = await Promise.all(chosenItems.map(ensureAladinCover));
    items.forEach(book => {
      book.description = makeBookDescription(book);
      book.matchedTags = book.matchedTags.map(tag => TAG_LABELS[tag] || tag).slice(0, 4);
    });

    const exclude = new Set(items.map(item => item.isbn));
    const popularCandidates = popularCandidateEntries(pool, exclude, seed);
    const popularEnriched = await enrichCandidates(popularCandidates, ['popular', 'readable'], popularLimit, `${seed}:popular`);
    const popularItems = await fillPopularItems(chooseDiverse(popularEnriched, popularLimit, `${seed}:popular`, exclude).map(book => ({
      ...book,
      description: makeBookDescription(book),
      matchedTags: ['동아인의 선택', '인기도서'],
    })), popularCandidates, popularLimit);

    const [notices, aladinBestSellers] = await Promise.all([
      fetchCommunityNotices(5),
      fetchAladinBestSellers(pool, 6),
    ]);

    return json(200, {
      apiVersion: API_VERSION,
      source: 'Dong-A University Library collections + Aladin ItemLookUp',
      shelfTitle: makeShelfTitle(tags),
      summary: `답변 ${answers.length}개를 바탕으로 도서관 컬렉션의 추천 후보를 분석했습니다.`,
      poolCount: pool.length,
      items,
      popularItems,
      aladinBestSellers,
      notices,
      seed: clientSeed,
      aladinEnabled: Boolean(process.env.ALADIN_TTB_KEY),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(500, {
      error: 'Recommendation failed.',
      message: error && error.message ? error.message : String(error),
    });
  }
};

exports.fetchCommunityNotices = fetchCommunityNotices;
exports.fetchCommunityNoticeResult = fetchCommunityNoticeResult;
