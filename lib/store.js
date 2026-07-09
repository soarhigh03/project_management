// 도메인 저장 로직 — 버그 / 기능(잡·태스크·의존성 그래프)
import * as kv from './kv.js';

const key = (project, name) => `tt:${project}:${name}`;
const now = () => new Date().toISOString();

const BUG_STATES = ['todo', 'doing', 'waiting', 'done'];

function parseAll(hash) {
  return Object.values(hash).map((v) => {
    try { return JSON.parse(v); } catch { return null; }
  }).filter(Boolean);
}

function cleanStr(v, max = 500) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

// ==================== 버그 ====================
export async function listBugs(project) {
  const bugs = parseAll(await kv.hgetall(key(project, 'bugs')));
  bugs.sort((a, b) => b.num - a.num);
  return bugs;
}

export async function createBug(project, input) {
  const title = cleanStr(input.title, 200);
  if (!title) throw badInput('제목을 입력하세요.');
  const num = await kv.incr(key(project, 'bug-seq'));
  const bug = {
    num,
    title,
    desc: cleanStr(input.desc, 5000),
    region: cleanStr(input.region, 100),
    urgency: cleanStr(input.urgency, 50) || 'mid',
    state: BUG_STATES.includes(input.state) ? input.state : 'todo',
    assignee: cleanStr(input.assignee, 100),
    reporter: cleanStr(input.reporter, 100),
    due: cleanStr(input.due, 20),
    createdAt: now(),
    updatedAt: now(),
  };
  await kv.hset(key(project, 'bugs'), num, JSON.stringify(bug));
  return bug;
}

export async function updateBug(project, num, patch) {
  const raw = await kv.hget(key(project, 'bugs'), num);
  if (!raw) return null;
  const bug = JSON.parse(raw);
  if (patch.title !== undefined) {
    const t = cleanStr(patch.title, 200);
    if (!t) throw badInput('제목을 입력하세요.');
    bug.title = t;
  }
  if (patch.desc !== undefined) bug.desc = cleanStr(patch.desc, 5000);
  if (patch.region !== undefined) bug.region = cleanStr(patch.region, 100);
  if (patch.urgency !== undefined) bug.urgency = cleanStr(patch.urgency, 50);
  if (patch.state !== undefined && BUG_STATES.includes(patch.state)) bug.state = patch.state;
  if (patch.assignee !== undefined) bug.assignee = cleanStr(patch.assignee, 100);
  if (patch.due !== undefined) bug.due = cleanStr(patch.due, 20);
  bug.updatedAt = now();
  await kv.hset(key(project, 'bugs'), num, JSON.stringify(bug));
  return bug;
}

export async function deleteBug(project, num) {
  await kv.hdel(key(project, 'bugs'), num);
}

// ==================== 기능 그래프 (잡 / 태스크 / 의존성) ====================
export async function getGraph(project) {
  const [jobsHash, edgesHash] = await Promise.all([
    kv.hgetall(key(project, 'jobs')),
    kv.hgetall(key(project, 'edges')),
  ]);
  return { jobs: parseAll(jobsHash), edges: parseAll(edgesHash) };
}

export async function addJob(project, input) {
  const id = 'j' + (await kv.incr(key(project, 'job-seq')));
  const job = {
    id,
    title: cleanStr(input.title, 200) || '새 작업',
    assignee: cleanStr(input.assignee, 100),
    x: Number.isFinite(+input.x) ? Math.round(+input.x) : 0,
    y: Number.isFinite(+input.y) ? Math.round(+input.y) : 0,
    tasks: [],
    createdAt: now(),
  };
  await kv.hset(key(project, 'jobs'), id, JSON.stringify(job));
  return job;
}

async function loadJob(project, jobId) {
  const raw = await kv.hget(key(project, 'jobs'), jobId);
  if (!raw) throw badInput('존재하지 않는 작업입니다.');
  return JSON.parse(raw);
}

async function saveJob(project, job) {
  await kv.hset(key(project, 'jobs'), job.id, JSON.stringify(job));
}

export async function updateJob(project, jobId, patch) {
  const job = await loadJob(project, jobId);
  if (patch.title !== undefined) {
    const t = cleanStr(patch.title, 200);
    if (t) job.title = t;
  }
  if (patch.assignee !== undefined) job.assignee = cleanStr(patch.assignee, 100);
  if (patch.x !== undefined && Number.isFinite(+patch.x)) job.x = Math.round(+patch.x);
  if (patch.y !== undefined && Number.isFinite(+patch.y)) job.y = Math.round(+patch.y);
  await saveJob(project, job);
  return job;
}

export async function deleteJob(project, jobId) {
  await loadJob(project, jobId); // 존재 확인
  await kv.hdel(key(project, 'jobs'), jobId);
  // 이 잡에 붙은 의존성 간선도 함께 삭제
  const edges = parseAll(await kv.hgetall(key(project, 'edges')));
  const dead = edges.filter((e) => e.from === jobId || e.to === jobId).map((e) => e.id);
  if (dead.length) await kv.hdel(key(project, 'edges'), ...dead);
}

export async function addTask(project, jobId, input) {
  const job = await loadJob(project, jobId);
  const title = cleanStr(input.title, 300);
  if (!title) throw badInput('할 일 내용을 입력하세요.');
  const tid = 't' + (await kv.incr(key(project, 'task-seq')));
  job.tasks.push({ id: tid, title, assignee: cleanStr(input.assignee, 100), done: false });
  await saveJob(project, job);
  return job;
}

export async function updateTask(project, jobId, taskId, patch) {
  const job = await loadJob(project, jobId);
  const task = job.tasks.find((t) => t.id === taskId);
  if (!task) throw badInput('존재하지 않는 할 일입니다.');
  if (patch.title !== undefined) {
    const t = cleanStr(patch.title, 300);
    if (t) task.title = t;
  }
  if (patch.assignee !== undefined) task.assignee = cleanStr(patch.assignee, 100);
  if (patch.done !== undefined) task.done = Boolean(patch.done);
  await saveJob(project, job);
  return job;
}

export async function deleteTask(project, jobId, taskId) {
  const job = await loadJob(project, jobId);
  job.tasks = job.tasks.filter((t) => t.id !== taskId);
  await saveJob(project, job);
  return job;
}

// 간선 추가: from(선행) → to(후행). 순환 의존성은 거부.
export async function addEdge(project, from, to) {
  if (!from || !to || from === to) throw badInput('잘못된 연결입니다.');
  const { jobs, edges } = await getGraph(project);
  const ids = new Set(jobs.map((j) => j.id));
  if (!ids.has(from) || !ids.has(to)) throw badInput('존재하지 않는 작업입니다.');
  if (edges.some((e) => e.from === from && e.to === to)) throw badInput('이미 연결되어 있습니다.');

  // 순환 검사: to에서 출발해 from에 도달할 수 있으면 순환이 생긴다
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  const stack = [to];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === from) throw badInput('순환 의존성이 생겨서 연결할 수 없습니다.');
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nxt of adj.get(cur) || []) stack.push(nxt);
  }

  const id = 'e' + (await kv.incr(key(project, 'edge-seq')));
  const edge = { id, from, to };
  await kv.hset(key(project, 'edges'), id, JSON.stringify(edge));
  return edge;
}

export async function deleteEdge(project, edgeId) {
  await kv.hdel(key(project, 'edges'), edgeId);
}

// ==================== 유틸 ====================
export function badInput(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}
