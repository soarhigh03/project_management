// 인증: scrypt 비밀번호 해시 + HMAC 서명 세션 쿠키 (외부 의존성 없음)
import crypto from 'node:crypto';
import { json } from './http.js';
import { getProject } from './config.js';

const COOKIE = 'tt_sess';
const SESSION_SECONDS = 7 * 24 * 3600; // 7일

function secret() {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.VERCEL) {
    // 배포 환경에서 시크릿 없이 굴러가면 위험하므로 명시적으로 실패시킨다
    throw new Error('AUTH_SECRET 환경 변수를 설정하세요. (예: openssl rand -base64 32)');
  }
  return 'dev-only-insecure-secret'; // 로컬 개발 전용
}

// ---------- 비밀번호 (scrypt) ----------
const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 32, SCRYPT);
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltHex, hashHex] = String(stored).split(':');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const key = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// ---------- 세션 쿠키 ----------
// 쿠키 값: base64url(JSON{ps:[프로젝트들], exp}) + "." + HMAC 서명
function sign(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function readSession(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const sig = Buffer.from(raw.slice(dot + 1));
  const expect = Buffer.from(sign(payload));
  if (sig.length !== expect.length || !crypto.timingSafeEqual(sig, expect)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Array.isArray(data.ps) || typeof data.exp !== 'number') return null;
    if (data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

function makeToken(projectIds) {
  const payload = Buffer.from(JSON.stringify({
    ps: projectIds,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function cookieString(value, req, maxAge) {
  const proto = req.headers['x-forwarded-proto'] || '';
  const secure = (proto === 'https' || process.env.VERCEL) ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// 로그인 성공 시: 기존 세션에 프로젝트 추가 (여러 프로젝트 동시 로그인 지원)
export function grantProject(req, res, projectId) {
  const sess = readSession(req);
  const ps = new Set(sess ? sess.ps : []);
  ps.add(projectId);
  res.setHeader('Set-Cookie', cookieString(makeToken([...ps]), req, SESSION_SECONDS));
}

export function clearSession(req, res) {
  res.setHeader('Set-Cookie', cookieString('', req, 0));
}

// API 공통 가드: 해당 프로젝트에 로그인된 요청인지 확인
export function requireProject(req, res) {
  const projectId = new URL(req.url, 'http://localhost').searchParams.get('project');
  const project = getProject(projectId);
  if (!project) { json(res, 404, { error: '존재하지 않는 프로젝트입니다.' }); return null; }
  const sess = readSession(req);
  if (!sess || !sess.ps.includes(projectId)) {
    json(res, 401, { error: '로그인이 필요합니다.' });
    return null;
  }
  return project;
}

// ---------- 로그인 시도 제한 (인스턴스 메모리 기준, 최선 노력) ----------
const attempts = new Map(); // key -> {count, resetAt}
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function rateLimitOk(req, projectId) {
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').toString().split(',')[0].trim();
  const key = `${ip}|${projectId}`;
  const now = Date.now();
  let a = attempts.get(key);
  if (!a || a.resetAt < now) { a = { count: 0, resetAt: now + WINDOW_MS }; attempts.set(key, a); }
  a.count += 1;
  if (attempts.size > 5000) attempts.clear(); // 메모리 보호
  return a.count <= MAX_ATTEMPTS;
}
