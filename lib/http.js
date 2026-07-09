// 공용 HTTP 헬퍼 — Vercel Node 함수와 로컬 dev 서버 양쪽에서 동일하게 동작
const MAX_BODY = 256 * 1024; // 256KB

export async function readJson(req) {
  // Vercel 런타임이 이미 body를 파싱해 둔 경우
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return null; }
    }
    if (Buffer.isBuffer(req.body)) {
      try { return JSON.parse(req.body.toString('utf8')); } catch { return null; }
    }
    if (typeof req.body === 'object') return req.body;
  }
  // 스트림에서 직접 읽기 (로컬 dev 서버)
  return await new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

export function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

export function query(req) {
  return new URL(req.url, 'http://localhost').searchParams;
}

// CSRF 완화: 상태 변경 요청은 Origin이 있으면 반드시 자기 호스트와 일치해야 함
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 같은 출처 fetch는 Origin을 생략할 수 있음
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}

export function guardMutation(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (!sameOrigin(req)) { json(res, 403, { error: '허용되지 않은 출처입니다.' }); return false; }
  return true;
}

// 메서드별 핸들러 라우팅 + 공통 에러 처리
export function route(handlers) {
  return async (req, res) => {
    try {
      if (!guardMutation(req, res)) return;
      const h = handlers[req.method];
      if (!h) {
        res.setHeader('Allow', Object.keys(handlers).join(', '));
        return json(res, 405, { error: '허용되지 않은 메서드입니다.' });
      }
      await h(req, res);
    } catch (err) {
      console.error('[api error]', err);
      json(res, 500, { error: '서버 오류가 발생했습니다.' });
    }
  };
}
