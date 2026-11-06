import crypto from 'node:crypto';
import * as kv from './kv.js';
import { listMeetings, getMeeting } from './store.js';

export const PROJECTS = ['patz', 'room42', 'mandudang'];
export const MEMBERS = ['은우', '민우', '채은', 'undefined'];
export const INITIAL_BUDGET = 2000000;
const TYPES = ['tasks', 'schedules', 'expenses', 'accounts', 'notes'];
const key = type => `tt:patz:dashboard:${type}`;
const now = () => new Date().toISOString();
const str = (value, max = 300) => String(value ?? '').trim().slice(0, max);
export function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
function required(value, label) { const v = str(value); if (!v) fail(`${label}을 입력하세요.`); return v; }
function date(value, optional = false) {
  if (!value && optional) return '';
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) fail('올바른 날짜를 입력하세요.');
  return value;
}
function project(value) { if (!PROJECTS.includes(value)) fail('프로젝트를 선택하세요.'); return value; }
function vaultKey() {
  const secret = process.env.VAULT_SECRET || process.env.AUTH_SECRET;
  if (process.env.VERCEL && (!secret || secret.length < 16)) fail('계정 저장용 서버 키를 설정해야 합니다.', 503);
  return crypto.createHash('sha256').update(secret || 'local-development-vault-only').digest();
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}
function decrypt(value) {
  const [iv, tag, data] = value.split('.').map(v => Buffer.from(v, 'base64'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', vaultKey(), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString());
}
function visible(record) {
  const { secret, legacyBody, ...rest } = record;
  // Show the full card number to authenticated team members; keep it encrypted at rest.
  if (record.kind === 'card' && secret) rest.summary = decrypt(secret).number || '';
  return rest;
}
function validateType(type) { if (!TYPES.includes(type)) fail('지원하지 않는 항목입니다.'); }
function newestFirst(a, b) {
  return (b.createdSequence || 0) - (a.createdSequence || 0)
    || (b.createdAt || '').localeCompare(a.createdAt || '')
    || b.id.localeCompare(a.id);
}
function sortTasks(tasks, order) {
  const positions = new Map(order.map((id, index) => [id, index]));
  return tasks.sort((a, b) => {
    const ai = positions.get(a.id), bi = positions.get(b.id);
    // New tasks precede the saved drag order until they are explicitly moved.
    if (ai === undefined && bi === undefined) return newestFirst(a, b);
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    return ai - bi;
  });
}

function normalize(type, input, existing = {}) {
  const item = { ...existing };
  const field = name => input[name] ?? existing[name];
  if (type === 'tasks') {
    item.title = required(field('title'), '항목');
    item.due = date(field('due'), true);
    item.project = project(field('project'));
    item.assignee = MEMBERS.includes(field('assignee')) ? field('assignee') : 'undefined';
    item.status = field('status') === 'finished' ? 'finished' : 'not finished';
    const subtasks = field('subtasks') || [];
    if (!Array.isArray(subtasks) || subtasks.length > 100) fail('세부 할 일은 100개까지 추가할 수 있습니다.');
    const seen = new Set();
    item.subtasks = subtasks.map(t => {
      let id = str(t.id, 80) || crypto.randomUUID();
      if (seen.has(id)) fail('중복된 세부 할 일입니다.');
      seen.add(id);
      return { id, title: required(t.title, '세부 할 일'), done: t.done === true };
    });
  } else if (type === 'schedules') {
    item.title = required(field('title'), '일정');
    item.date = date(field('date'));
    item.project = project(field('project'));
    item.important = field('important') === true;
  } else if (type === 'expenses') {
    item.title = required(field('title'), '항목');
    item.date = date(field('date'));
    item.quantity = Number(field('quantity') ?? 1);
    item.unitPrice = Number(field('unitPrice') ?? field('amount'));
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000) fail('수량은 1 이상의 정수로 입력하세요.');
    if (!Number.isSafeInteger(item.unitPrice) || item.unitPrice < 0) fail('단가는 0원 이상의 정수로 입력하세요.');
    item.amount = item.quantity * item.unitPrice;
    if (!Number.isSafeInteger(item.amount) || item.amount < 0 || item.amount > 1000000000) fail('가격은 0원 이상 정수로 입력하세요.');
  } else if (type === 'accounts') {
    item.kind = field('kind') === 'card' ? 'card' : 'account';
    item.title = required(field('title'), item.kind === 'card' ? '카드 이름' : '서비스 이름');
    const previous = existing.secret ? decrypt(existing.secret) : {};
    const secret = { ...previous };
    for (const name of ['username', 'password', 'number', 'holder', 'expiry', 'memo']) {
      if (input[name] !== undefined) secret[name] = name === 'password' ? String(input[name]).slice(0, 1000) : str(input[name], 1000);
    }
    if (item.kind === 'card') {
      secret.number = (secret.number || '').replace(/[ -]/g, '');
      if (!/^\d{12,19}$/.test(secret.number)) fail('카드 번호는 12~19자리 숫자로 입력하세요.');
      if (secret.expiry && !/^(0[1-9]|1[0-2])\/\d{2}$/.test(secret.expiry)) fail('유효기간은 MM/YY로 입력하세요.');
      item.summary = `•••• ${secret.number.slice(-4)}`;
    } else {
      secret.username = required(secret.username, '아이디');
      item.summary = secret.username;
    }
    item.secret = encrypt(secret);
  } else if (type === 'notes') {
    item.title = required(field('title') || '새 회의록', '회의록 제목');
    item.date = date(field('date') || new Date().toISOString().slice(0, 10));
  }
  return item;
}

export async function getRecord(type, id, includeSecret = false) {
  validateType(type);
  const raw = await kv.hget(key(type), id);
  if (!raw) return null;
  const item = JSON.parse(raw);
  if (item.deleted) return null;
  return includeSecret ? item : visible(item);
}
export async function listRecords(type) {
  validateType(type);
  return Object.values(await kv.hgetall(key(type))).map(JSON.parse).filter(r => !r.deleted).map(visible);
}
export async function createRecord(type, input) {
  validateType(type);
  const fields = normalize(type, input);
  // The shared counter also orders simultaneous additions with equal timestamps.
  const createdSequence = type === 'schedules' ? null : await kv.incr(key('created-sequence'));
  const createdAt = now();
  const record = { ...fields, id: crypto.randomUUID(), createdAt, updatedAt: createdAt, version: 1,
    ...(createdSequence === null ? {} : { createdSequence }) };
  await kv.hset(key(type), record.id, JSON.stringify(record));
  return visible(record);
}
export async function updateRecord(type, id, input) {
  validateType(type);
  for (let attempt = 0; attempt < 10; attempt++) {
    const raw = await kv.hget(key(type), id);
    if (!raw || JSON.parse(raw).deleted) fail('항목을 찾을 수 없습니다.', 404);
    const old = JSON.parse(raw);
    if (input.baseVersion !== undefined && input.baseVersion !== old.version) fail('팀원이 이 항목을 수정했습니다. 최신 내용을 다시 열어 확인하세요.', 409);
    const record = { ...normalize(type, input, old), updatedAt: now(), version: old.version + 1 };
    if (await kv.compareAndSet(key(type), id, raw, JSON.stringify(record))) return visible(record);
  }
  fail('다른 변경을 저장 중입니다. 다시 시도하세요.', 409);
}
export async function deleteRecord(type, id) {
  validateType(type);
  // Tombstones keep accidental deletions recoverable and avoid update resurrection.
  for (let attempt = 0; attempt < 10; attempt++) {
    const raw = await kv.hget(key(type), id);
    if (!raw) return;
    const record = { ...JSON.parse(raw), deleted: true, deletedAt: now() };
    if (await kv.compareAndSet(key(type), id, raw, JSON.stringify(record))) return;
  }
  fail('다시 시도하세요.', 409);
}
export async function revealAccount(id) {
  const item = await getRecord('accounts', id, true);
  if (!item) fail('계정을 찾을 수 없습니다.', 404);
  return decrypt(item.secret);
}
export async function reorderTask(id, beforeId) {
  const tasks = await listRecords('tasks');
  if (!tasks.some(t => t.id === id) || (beforeId && !tasks.some(t => t.id === beforeId))) fail('작업을 찾을 수 없습니다.', 404);
  if (id === beforeId) return;
  for (let attempt = 0; attempt < 10; attempt++) {
    const raw = await kv.hget(key('order'), 'tasks');
    const ids = sortTasks(tasks, JSON.parse(raw || '[]')).map(task => task.id).filter(taskId => taskId !== id);
    const at = beforeId ? ids.indexOf(beforeId) : ids.length;
    ids.splice(at < 0 ? ids.length : at, 0, id);
    if (await kv.compareAndSet(key('order'), 'tasks', raw, JSON.stringify(ids))) return;
  }
  fail('순서가 변경되었습니다. 다시 시도하세요.', 409);
}
export async function importLegacyNotes() {
  const meetings = await listMeetings('patz');
  for (const meeting of meetings) {
    const id = `legacy-${meeting.id}`;
    if (await kv.hget(key('notes'), id)) continue;
    const source = await getMeeting('patz', meeting.id);
    const record = { ...meeting, id, version: 1, legacyBody: source?.body || '' };
    await kv.compareAndSet(key('notes'), id, null, JSON.stringify(record));
  }
}
export async function getDashboard() {
  await importLegacyNotes();
  const [tasks, schedules, expenses, accounts, notes, rawOrder] = await Promise.all([
    ...TYPES.map(listRecords), kv.hget(key('order'), 'tasks'),
  ]);
  sortTasks(tasks, JSON.parse(rawOrder || '[]'));
  schedules.sort((a,b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  expenses.sort(newestFirst);
  accounts.sort(newestFirst);
  notes.sort(newestFirst);
  const spent = expenses.reduce((sum, e) => sum + e.amount, 0);
  return { tasks, schedules, expenses, accounts, notes, budget: { initial: INITIAL_BUDGET, spent, remaining: INITIAL_BUDGET - spent }, projects: PROJECTS, members: MEMBERS };
}
