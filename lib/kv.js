// 저장소 어댑터
//  - 배포(Vercel): Upstash Redis REST API (Vercel Marketplace의 KV) — fetch만 사용, 의존성 없음
//  - 로컬 개발: data/kv.json 파일
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const useRedis = Boolean(REST_URL && REST_TOKEN);

if (!useRedis && process.env.VERCEL) {
  console.warn('[kv] 경고: KV_REST_API_URL / KV_REST_API_TOKEN이 없습니다. Vercel에서는 데이터가 저장되지 않습니다!');
}

// ---------- Redis (Upstash REST) ----------
async function redis(cmd) {
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`KV 요청 실패 ${r.status}: ${await r.text()}`);
  const data = await r.json();
  if (data.error) throw new Error(`KV 오류: ${data.error}`);
  return data.result;
}

// ---------- 로컬 파일 ----------
const DATA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'kv.json');

function fileLoad() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { counters: {}, hashes: {} };
  }
}

function fileSave(store) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DATA_FILE); // 원자적 교체
}

// ---------- 공용 인터페이스 ----------
export async function incr(key) {
  if (useRedis) return await redis(['INCR', key]);
  const s = fileLoad();
  s.counters[key] = (s.counters[key] || 0) + 1;
  fileSave(s);
  return s.counters[key];
}

export async function hgetall(key) {
  if (useRedis) {
    const flat = await redis(['HGETALL', key]);
    const out = {};
    for (let i = 0; i < (flat || []).length; i += 2) out[flat[i]] = flat[i + 1];
    return out;
  }
  const s = fileLoad();
  return { ...(s.hashes[key] || {}) };
}

export async function hget(key, field) {
  if (useRedis) return await redis(['HGET', key, String(field)]);
  const s = fileLoad();
  return (s.hashes[key] || {})[field] ?? null;
}

export async function hset(key, field, value) {
  if (useRedis) return await redis(['HSET', key, String(field), String(value)]);
  const s = fileLoad();
  s.hashes[key] = s.hashes[key] || {};
  s.hashes[key][field] = String(value);
  fileSave(s);
}

export async function hdel(key, ...fields) {
  if (!fields.length) return;
  if (useRedis) return await redis(['HDEL', key, ...fields.map(String)]);
  const s = fileLoad();
  if (s.hashes[key]) for (const f of fields) delete s.hashes[key][f];
  fileSave(s);
}

export function backendName() {
  return useRedis ? 'redis' : 'file';
}
