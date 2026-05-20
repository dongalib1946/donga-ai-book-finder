const crypto = require('crypto');
const questions = require('../data/questions.json');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
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

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const url = new URL(event.rawUrl || `http://localhost${event.path || '/.netlify/functions/questions'}`);
  const limit = Math.min(10, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '5', 10) || 5));
  const pool = questions.filter(validQuestion);

  if (!pool.length) {
    return json(500, { error: 'No questions are configured.' });
  }

  return json(200, {
    version: 'questions-v1',
    limit,
    total: pool.length,
    questions: shuffled(pool).slice(0, Math.min(limit, pool.length)),
    seed: crypto.randomUUID(),
  });
};
