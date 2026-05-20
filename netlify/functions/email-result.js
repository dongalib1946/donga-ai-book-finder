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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatKoreanDate(value) {
  return new Date(value).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function compactText(value, maxLength = 140) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function bookMeta(book) {
  return [book.author, book.publisher, book.collection].filter(Boolean).join(' · ');
}

function bookReason(book) {
  return compactText(book.reason || book.description || '선택한 답변의 분위기와 잘 맞아 추천 목록에 담았습니다.', 150);
}

function mailText(result, resultUrl, expiresAt) {
  const books = (result.items || [])
    .slice(0, 5)
    .map((book, index) => [
      `${index + 1}. ${book.title || '제목 정보 없음'}`,
      bookMeta(book) ? `   ${bookMeta(book)}` : '',
      `   추천 이유: ${bookReason(book)}`,
    ].filter(Boolean).join('\n'))
    .join('\n');

  return [
    '[동아대학교 도서관] AI가 찾아주는 오늘의 책',
    `${result.shelfTitle || 'AI가 추천한 오늘의 책'}`,
    result.summary || '답변을 바탕으로 지금 읽기 좋은 책을 골랐습니다.',
    '',
    '추천 결과 페이지',
    resultUrl,
    '',
    '추천 도서',
    books || '추천 도서 정보가 없습니다.',
    '',
    `이 링크는 ${formatKoreanDate(expiresAt)}까지 보관됩니다.`,
    '',
    '동아대학교 도서관',
  ].join('\n');
}

function mailHtml(result, resultUrl, expiresAt) {
  const shelfTitle = escapeHtml(result.shelfTitle || 'AI가 추천한 오늘의 책');
  const summary = escapeHtml(result.summary || '답변을 바탕으로 지금 읽기 좋은 책을 골랐습니다.');
  const expiresText = escapeHtml(formatKoreanDate(expiresAt));
  const books = (result.items || [])
    .slice(0, 5)
    .map((book, index) => {
      const tags = Array.isArray(book.matchedTags)
        ? book.matchedTags.slice(0, 3).map(tag => `
          <span style="display:inline-block;margin:0 6px 6px 0;padding:4px 9px;border-radius:999px;background:#edf7f5;color:#18625f;font-size:12px;line-height:1.2">${escapeHtml(tag)}</span>
        `).join('')
        : '';
      return `
        <tr>
          <td style="padding:0 0 14px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #e5eef0;border-radius:16px">
              <tr>
                <td width="54" valign="top" style="padding:18px 0 18px 18px">
                  <div style="width:38px;height:38px;border-radius:12px;background:#0f5579;color:#ffffff;text-align:center;line-height:38px;font-size:15px;font-weight:800">
                    ${String(index + 1).padStart(2, '0')}
                  </div>
                </td>
                <td valign="top" style="padding:17px 18px 14px 12px">
                  <h3 style="margin:0 0 7px;color:#102a43;font-size:18px;line-height:1.35;font-weight:800">${escapeHtml(book.title || '제목 정보 없음')}</h3>
                  ${bookMeta(book) ? `<p style="margin:0 0 10px;color:#64748b;font-size:13px;line-height:1.5">${escapeHtml(bookMeta(book))}</p>` : ''}
                  <p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.65">${escapeHtml(bookReason(book))}</p>
                  ${tags ? `<div style="font-size:0;line-height:1">${tags}</div>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <div style="margin:0;padding:0;background:#eef6f6;font-family:Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#102a43">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#eef6f6">
        <tr>
          <td align="center" style="padding:28px 12px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;max-width:640px;background:#f8fcfc;border:1px solid #dbeaec;border-radius:24px;overflow:hidden">
              <tr>
                <td style="padding:30px 28px 26px;background:#0f5579">
                  <p style="margin:0 0 12px;color:#b9edf0;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Dong-A Library AI Book Finder</p>
                  <h1 style="margin:0;color:#ffffff;font-size:28px;line-height:1.28;font-weight:900">${shelfTitle}</h1>
                  <p style="margin:14px 0 0;color:#dff8f7;font-size:15px;line-height:1.7">${summary}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 28px 4px;background:#f8fcfc">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
                    <tr>
                      <td style="padding:0 0 18px;color:#334155;font-size:15px;line-height:1.7">
                        추천 결과 페이지에서 도서관 소장 위치와 함께 전체 추천 목록을 다시 확인할 수 있습니다.
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:0 0 26px">
                        <a href="${escapeHtml(resultUrl)}" style="display:inline-block;padding:14px 22px;background:#103b5c;color:#ffffff;text-decoration:none;border-radius:12px;font-size:15px;font-weight:800">추천 결과 보기</a>
                      </td>
                    </tr>
                  </table>
                  <h2 style="margin:0 0 14px;color:#102a43;font-size:18px;line-height:1.4;font-weight:900">추천 도서</h2>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
                    ${books || '<tr><td style="padding:18px;color:#64748b;background:#ffffff;border:1px solid #e5eef0;border-radius:16px">추천 도서 정보가 없습니다.</td></tr>'}
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 28px 28px;background:#f8fcfc">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#fff8e6;border:1px solid #f2dfac;border-radius:16px">
                    <tr>
                      <td style="padding:16px 18px;color:#67511b;font-size:13px;line-height:1.65">
                        이 링크는 <strong>${expiresText}</strong>까지 보관됩니다. 기간이 지나면 새 추천을 받아 다시 공유해 주세요.
                      </td>
                    </tr>
                  </table>
                  <p style="margin:20px 0 0;color:#64748b;font-size:13px;line-height:1.6">동아대학교 도서관</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
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
    subject: `[동아대학교 도서관] ${result.shelfTitle || 'AI 추천 도서 결과'} 추천 결과`,
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
