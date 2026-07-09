// 로컬 개발 서버 — Vercel의 정적 파일 + /api 함수 라우팅을 그대로 흉내낸다
// 실행: npm run dev  → http://localhost:3000
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../lib/config.js';
import { backendName } from '../lib/kv.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const apiHandlers = {};
for (const name of ['auth', 'config', 'bugs', 'features']) {
  apiHandlers[name] = (await import(`../api/${name}.js`)).default;
}

validateConfig();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // API 라우팅
  if (p.startsWith('/api/')) {
    const name = p.slice(5).replace(/\/+$/, '');
    const handler = apiHandlers[name];
    if (!handler) { res.statusCode = 404; return res.end('{"error":"not found"}'); }
    return handler(req, res);
  }

  // /p/* 요청은 세션 쿠키가 없으면 로그인 화면으로 리다이렉트 (vercel.json redirects와 동일)
  if (p.startsWith('/p/') && !/(?:^|;\s*)tt_sess=/.test(req.headers.cookie || '')) {
    res.statusCode = 302;
    res.setHeader('Location', '/');
    return res.end();
  }

  // 정적 파일 (+ /p/* → app.html 리라이트, vercel.json과 동일)
  let file = p === '/' ? '/index.html' : p;
  if (p.startsWith('/p/')) file = '/app.html';
  const full = path.normalize(path.join(PUBLIC, file));
  if (!full.startsWith(PUBLIC)) { res.statusCode = 403; return res.end('forbidden'); }
  try {
    const data = await fs.readFile(full);
    res.setHeader('Content-Type', MIME[path.extname(full)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  ▶ http://localhost:${PORT}`);
  console.log(`  저장소 백엔드: ${backendName() === 'file' ? '로컬 파일 (data/kv.json)' : 'Upstash Redis'}\n`);
});
