const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'shared-results';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 240 * 1024;
const LOCAL_STORE_DIR = path.join(__dirname, '..', '..', '.netlify', 'local-shared-results');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
    body: JSON.stringify(body),
  };
}

function useLocalStore() {
  return process.env.AI_BOOK_FINDER_LOCAL_STORE === '1';
}

function storeOptions() {
  const options = { name: STORE_NAME, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_AUTH_TOKEN) {
    options.siteID = process.env.NETLIFY_SITE_ID;
    options.token = process.env.NETLIFY_AUTH_TOKEN;
  }
  return options;
}

function safeResultId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : '';
}

function newResultId() {
  return crypto.randomBytes(12).toString('base64url');
}

function readPayload(event) {
  const body = event.body || '';
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    const error = new Error('Shared result is too large.');
    error.statusCode = 413;
    throw error;
  }
  try {
    return JSON.parse(body || '{}');
  } catch (error) {
    const invalid = new Error('Invalid JSON body.');
    invalid.statusCode = 400;
    throw invalid;
  }
}

function compactResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  return {
    shelfTitle: result.shelfTitle || '',
    summary: result.summary || '',
    items: Array.isArray(result.items) ? result.items.slice(0, 8) : [],
    popularItems: Array.isArray(result.popularItems) ? result.popularItems.slice(0, 8) : [],
    aladinBestSellers: Array.isArray(result.aladinBestSellers) ? result.aladinBestSellers.slice(0, 8) : [],
    notices: Array.isArray(result.notices) ? result.notices.slice(0, 8) : [],
    educationPrograms: Array.isArray(result.educationPrograms) ? result.educationPrograms.slice(0, 8) : [],
  };
}

async function setEntry(id, payload) {
  if (useLocalStore()) {
    await fs.mkdir(LOCAL_STORE_DIR, { recursive: true });
    await fs.writeFile(path.join(LOCAL_STORE_DIR, `${id}.json`), JSON.stringify(payload), 'utf8');
    return;
  }

  const store = getStore(storeOptions());
  await store.setJSON(id, payload);
}

async function getEntry(id) {
  if (useLocalStore()) {
    try {
      const file = await fs.readFile(path.join(LOCAL_STORE_DIR, `${id}.json`), 'utf8');
      return JSON.parse(file);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  const store = getStore(storeOptions());
  return store.get(id, { type: 'json', consistency: 'strong' });
}

async function deleteEntry(id) {
  if (useLocalStore()) {
    await fs.rm(path.join(LOCAL_STORE_DIR, `${id}.json`), { force: true });
    return;
  }

  const store = getStore(storeOptions());
  await store.delete(id);
}

async function createSharedResult(event) {
  const body = readPayload(event);
  const result = compactResult(body.result);
  if (!result || !result.items.length) {
    return json(400, { error: 'A recommendation result is required.' });
  }

  const now = Date.now();
  const id = newResultId();
  const payload = {
    id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
    result,
  };

  await setEntry(id, payload);
  return json(200, { id, expiresAt: payload.expiresAt });
}

async function readSharedResult(event) {
  const url = new URL(event.rawUrl || `http://localhost${event.path || '/.netlify/functions/shared-result'}`);
  const id = safeResultId(url.searchParams.get('id'));
  if (!id) return json(400, { error: 'A valid result id is required.' });

  const payload = await getEntry(id);
  if (!payload) return json(404, { error: 'Shared result not found.' });

  if (Date.parse(payload.expiresAt || '') <= Date.now()) {
    await deleteEntry(id);
    return json(410, { error: 'Shared result has expired.' });
  }

  return json(200, {
    id: payload.id,
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
    result: payload.result,
  });
}

async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});

  try {
    if (event.httpMethod === 'POST') return createSharedResult(event);
    if (event.httpMethod === 'GET') return readSharedResult(event);
    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.message || 'Shared result failed.' });
  }
}

exports.handler = handler;
exports.createSharedResult = createSharedResult;
