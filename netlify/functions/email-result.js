const nodemailer = require('nodemailer');
const sharedResult = require('./shared-result.js');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY_BYTES = 240 * 1024;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
    body: JSON.stringify(body),
  };
}

function readPayload(event) {
  const body = event.body || '';
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    const error = new Error('Email request is too large.');
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

function siteOrigin(event) {
  const headers = event.headers || {};
  const origin = headers.origin || headers.Origin;
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, '');

  const rawUrl = event.rawUrl || '';
  if (rawUrl) {
    try {
      return new URL(rawUrl).origin;
    } catch (error) {
      // Ignore malformed local test URLs.
    }
  }

  const host = headers.host || headers.Host || 'localhost:8787';
  const proto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'http';
  return `${proto}://${host}`;
}

function requireSmtpConfig() {
  const config = {
    host: process.env.SMTP_HOST,
    port: Number.parseInt(process.env.SMTP_PORT || '587', 10),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
  };

  if (!config.host || !config.user || !config.pass || !config.from) {
    const error = new Error('메일 발송 설정이 아직 등록되지 않았습니다. Netlify 환경변수 SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM을 설정해 주세요.');
    error.statusCode = 500;
    throw error;
  }

  return config;
}

function mailText(result, resultUrl, expiresAt) {
  const books = (result.items || [])
    .slice(0, 5)
    .map((book, index) => `${index + 1}. ${book.title || '제목 정보 없음'}${book.author ? ` - ${book.author}` : ''}`)
    .join('\n');

  return [
    `${result.shelfTitle || 'AI가 추천한 오늘의 책'}`,
    '',
    '아래 링크에서 추천 결과 페이지를 확인할 수 있습니다.',
    resultUrl,
    '',
    '추천 도서',
    books || '추천 도서 정보가 없습니다.',
    '',
    `이 링크는 ${new Date(expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}까지 보관됩니다.`,
    '',
    '동아대학교 도서관',
  ].join('\n');
}

function mailHtml(result, resultUrl, expiresAt) {
  const escape = value => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const books = (result.items || [])
    .slice(0, 5)
    .map((book, index) => `<li><strong>${index + 1}. ${escape(book.title || '제목 정보 없음')}</strong>${book.author ? ` <span>${escape(book.author)}</span>` : ''}</li>`)
    .join('');

  return `
    <div style="font-family:Arial,'Noto Sans KR',sans-serif;line-height:1.6;color:#14213d">
      <h2 style="margin:0 0 12px">${escape(result.shelfTitle || 'AI가 추천한 오늘의 책')}</h2>
      <p>아래 버튼에서 추천 결과 페이지를 확인할 수 있습니다.</p>
      <p>
        <a href="${escape(resultUrl)}" style="display:inline-block;padding:12px 18px;background:#0f5579;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">추천 결과 보기</a>
      </p>
      <h3 style="margin:24px 0 8px">추천 도서</h3>
      <ol style="padding-left:22px">${books || '<li>추천 도서 정보가 없습니다.</li>'}</ol>
      <p style="margin-top:24px;color:#667085;font-size:13px">이 링크는 ${escape(new Date(expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }))}까지 보관됩니다.</p>
      <p style="color:#667085;font-size:13px">동아대학교 도서관</p>
    </div>
  `;
}

async function sendResultMail({ to, result, resultUrl, expiresAt }) {
  const config = requireSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  const info = await transporter.sendMail({
    from: config.from,
    envelope: {
      from: config.user,
      to,
    },
    to,
    replyTo: config.from,
    subject: `[동아대학교 도서관] ${result.shelfTitle || 'AI 추천 도서 결과'}`,
    text: mailText(result, resultUrl, expiresAt),
    html: mailHtml(result, resultUrl, expiresAt),
    headers: {
      'X-Auto-Response-Suppress': 'All',
    },
  });

  if (Array.isArray(info.rejected) && info.rejected.length) {
    const error = new Error(`메일 서버가 수신자를 거절했습니다: ${info.rejected.join(', ')}`);
    error.statusCode = 502;
    throw error;
  }

  return info;
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const body = readPayload(event);
    const email = String(body.email || '').trim();
    if (!EMAIL_RE.test(email)) return json(400, { error: '올바른 이메일 주소를 입력해 주세요.' });

    const saved = await sharedResult.createSharedResult({
      ...event,
      httpMethod: 'POST',
      body: JSON.stringify({ result: body.result }),
    });
    const savedBody = JSON.parse(saved.body || '{}');
    if (saved.statusCode >= 400) return json(saved.statusCode, savedBody);

    const resultUrl = `${siteOrigin(event)}/?resultId=${encodeURIComponent(savedBody.id)}`;
    const mailInfo = await sendResultMail({
      to: email,
      result: body.result,
      resultUrl,
      expiresAt: savedBody.expiresAt,
    });

    return json(200, {
      sent: true,
      resultUrl,
      expiresAt: savedBody.expiresAt,
      accepted: Array.isArray(mailInfo.accepted) ? mailInfo.accepted.length : 0,
    });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.message || '메일 발송에 실패했습니다.' });
  }
};
