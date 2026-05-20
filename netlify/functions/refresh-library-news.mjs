import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { refreshLibraryNewsSnapshot } = require('./refresh-library-news-core.js');

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default async function refreshLibraryNews() {
  const body = await refreshLibraryNewsSnapshot();
  console.log('[Library news refresh]', JSON.stringify(body));
  return response(200, body);
}
