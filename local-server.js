const http = require('http');
const fs = require('fs');
const path = require('path');
process.env.AI_BOOK_FINDER_LOCAL_STORE = '1';
const recommend = require('./netlify/functions/recommend-books.js');
const questions = require('./netlify/functions/questions.js');
const sharedResult = require('./netlify/functions/shared-result.js');
const emailResult = require('./netlify/functions/email-result.js');

const ROOT = __dirname;
const PUBLIC_ROOT = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res, statusCode, headers, body) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/.netlify/functions/recommend-books') {
      const body = req.method === 'POST' ? await readBody(req) : '';
      const result = await recommend.handler({
        httpMethod: req.method,
        headers: req.headers,
        path: url.pathname,
        rawUrl: url.toString(),
        body,
      });
      return send(res, result.statusCode, result.headers || {}, result.body || '');
    }
    if (url.pathname === '/.netlify/functions/questions') {
      const result = await questions.handler({
        httpMethod: req.method,
        headers: req.headers,
        path: url.pathname,
        rawUrl: url.toString(),
        body: '',
      });
      return send(res, result.statusCode, result.headers || {}, result.body || '');
    }
    if (url.pathname === '/.netlify/functions/shared-result') {
      const body = req.method === 'POST' ? await readBody(req) : '';
      const result = await sharedResult.handler({
        httpMethod: req.method,
        headers: req.headers,
        path: url.pathname,
        rawUrl: url.toString(),
        body,
      });
      return send(res, result.statusCode, result.headers || {}, result.body || '');
    }
    if (url.pathname === '/.netlify/functions/email-result') {
      const body = req.method === 'POST' ? await readBody(req) : '';
      const result = await emailResult.handler({
        httpMethod: req.method,
        headers: req.headers,
        path: url.pathname,
        rawUrl: url.toString(),
        body,
      });
      return send(res, result.statusCode, result.headers || {}, result.body || '');
    }

    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const normalized = path.normalize(decodeURIComponent(requested)).replace(/^[/\\]+/, '');
    const filePath = path.join(PUBLIC_ROOT, normalized);
    if (!filePath.startsWith(`${PUBLIC_ROOT}${path.sep}`) && filePath !== PUBLIC_ROOT) {
      return send(res, 403, { 'content-type': 'text/plain; charset=utf-8' }, 'Forbidden');
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    return send(res, 200, { 'content-type': TYPES[ext] || 'application/octet-stream' }, fs.readFileSync(filePath));
  } catch (error) {
    return send(res, 500, { 'content-type': 'text/plain; charset=utf-8' }, error.message || String(error));
  }
});

server.listen(PORT, () => {
  console.log(`AI Book Finder local server: http://localhost:${PORT}`);
});
