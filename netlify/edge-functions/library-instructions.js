const LIBRARY_INSTRUCTION_URL = 'https://library.donga.ac.kr/research-support/library-instruction/library-instruction-request/';
const LIBRARY_AJAX_URL = 'https://library.donga.ac.kr/wp-admin/admin-ajax.php';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function kstMonthRange() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const year = Number.parseInt(parts.year, 10);
  const month = Number.parseInt(parts.month, 10);
  const day = Number.parseInt(parts.day, 10);
  const monthText = pad2(month);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return json({});
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const startedAt = Date.now();
  try {
    const requestUrl = new URL(request.url);
    const limit = Math.min(10, Math.max(1, Number.parseInt(requestUrl.searchParams.get('limit') || '5', 10) || 5));
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
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
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
    const items = (Array.isArray(data.educations) ? data.educations : [])
      .map(item => normalizeInstruction(item, range.monthKey))
      .filter(Boolean)
      .slice(0, limit);
    return json({ items, updatedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt });
  } catch (error) {
    return json({ items: [], error: error.message, updatedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt });
  }
}
