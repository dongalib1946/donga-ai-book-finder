const LIBRARY_INSTRUCTION_URL = 'https://library.donga.ac.kr/research-support/library-instruction/library-instruction-request/';
const LIBRARY_AJAX_URL = 'https://library.donga.ac.kr/wp-admin/admin-ajax.php';
const FETCH_TIMEOUT_MS = Math.max(1500, Number.parseInt(process.env.INSTRUCTION_FETCH_TIMEOUT_MS || '6000', 10) || 6000);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'cdn-cache-control': 'no-store',
      'netlify-cdn-cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
    body: JSON.stringify(body),
  };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function kstDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    year: Number.parseInt(parts.year, 10),
    month: Number.parseInt(parts.month, 10),
    day: Number.parseInt(parts.day, 10),
  };
}

function kstMonthRange() {
  const { year, month, day } = kstDateParts();
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthText = pad2(month);
  return {
    today: `${year}-${monthText}-${pad2(day)}`,
    monthEnd: `${year}-${monthText}-${pad2(lastDay)}`,
    monthKey: `${year}-${monthText}`,
  };
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

function normalizeInstruction(item, monthKey) {
  const title = cleanText(item && (item.post_title || item.title));
  const date = cleanText(item && item.startday);
  if (!title || !date || !date.startsWith(monthKey)) return null;
  return {
    id: item.ID || item.education_id || '',
    title,
    date: date.replace(/-/g, '.'),
    url: LIBRARY_INSTRUCTION_URL,
  };
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

async function fetchInstructions(limit = 5) {
  const range = kstMonthRange();
  const body = new URLSearchParams({
    action: 'lem_get_educations',
    mod: 'list',
    education_id: '',
    startday: range.today,
    endday: range.monthEnd,
    order: 'ASC',
    posts_per_page: '-1',
    paged: '1',
    location: '',
  });
  const url = new URL(LIBRARY_AJAX_URL);
  url.searchParams.set('_', String(Date.now()));
  const res = await fetchWithTimeout(url.toString(), {
    method: 'POST',
    headers: {
      'user-agent': 'DongALibraryAIBookFinder/1.0',
      accept: 'application/json,text/plain,*/*',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      referer: LIBRARY_INSTRUCTION_URL,
      'x-requested-with': 'XMLHttpRequest',
    },
    body,
  });
  if (!res.ok) throw new Error(`Library instruction API failed ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data.educations) ? data.educations : [])
    .map(item => normalizeInstruction(item, range.monthKey))
    .filter(Boolean)
    .slice(0, limit);
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const startedAt = Date.now();
  try {
    const limit = Math.min(10, Math.max(1, Number.parseInt((event.queryStringParameters || {}).limit || '5', 10) || 5));
    const items = await fetchInstructions(limit);
    console.info('[Library instructions]', items.length, `in ${Date.now() - startedAt}ms`);
    return json(200, { items, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.warn('[Library instructions]', error.message, `after ${Date.now() - startedAt}ms`);
    return json(200, { items: [], error: error.message, updatedAt: new Date().toISOString() });
  }
};
