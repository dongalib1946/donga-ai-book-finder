const crypto = require('crypto');
const questions = require('../data/questions.json');

const PSYCH_QUESTION_IDS = new Set([
  'secret-door',
  'cafe-seat',
  'after-exam',
  'playlist',
  'vending-machine',
  'library-corner',
  'desk-item',
  'weekend-plan',
  'notification',
  'tiny-ritual',
  'offline-pocket',
]);

function json(statusCode, body, cacheControl = 'public, max-age=300, s-maxage=900, stale-while-revalidate=1800') {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'cdn-cache-control': cacheControl,
      'netlify-cdn-cache-control': cacheControl,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
    body: JSON.stringify(body),
  };
}

function shuffled(items) {
  return [...items]
    .map(item => ({ item, sort: crypto.randomInt(0, 1_000_000_000) }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ item }) => item);
}

function validQuestion(question) {
  return question
    && typeof question.id === 'string'
    && typeof question.title === 'string'
    && Array.isArray(question.choices)
    && question.choices.length >= 2;
}

function balancedQuestionSet(pool, limit) {
  const max = Math.min(limit, pool.length);
  const psych = pool.filter(question => PSYCH_QUESTION_IDS.has(question.id));
  const core = pool.filter(question => !PSYCH_QUESTION_IDS.has(question.id));
  if (!psych.length || !core.length || max < 3) return shuffled(pool).slice(0, max);

  const psychLimit = Math.min(psych.length, Math.max(1, Math.floor(max * 0.4)));
  const selected = [
    ...shuffled(core).slice(0, max - psychLimit),
    ...shuffled(psych).slice(0, psychLimit),
  ];

  if (selected.length < max) {
    const selectedIds = new Set(selected.map(question => question.id));
    selected.push(...shuffled(pool.filter(question => !selectedIds.has(question.id))).slice(0, max - selected.length));
  }

  return shuffled(selected).slice(0, max);
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {}, 'no-store');
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' }, 'no-store');

  const url = new URL(event.rawUrl || `http://localhost${event.path || '/.netlify/functions/questions'}`);
  const limit = Math.min(10, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '5', 10) || 5));
  const pool = questions.filter(validQuestion);

  if (!pool.length) {
    return json(500, { error: 'No questions are configured.' }, 'no-store');
  }

  return json(200, {
    version: 'questions-v1',
    limit,
    total: pool.length,
    questions: balancedQuestionSet(pool, limit),
    seed: crypto.randomUUID(),
  });
};
