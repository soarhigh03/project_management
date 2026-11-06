import { route, readJson, json, query } from '../lib/http.js';
import { requireProject } from '../lib/auth.js';
import * as db from '../lib/dashboard.js';

function authorize(req, res) {
  const project = requireProject(req, res);
  if (!project) return false;
  if (project.id !== 'patz') { json(res, 403, { error: 'PATZ 팀 로그인이 필요합니다.' }); return false; }
  return true;
}
async function run(req, res) {
  if (!authorize(req, res)) return;
  try {
    if (req.method === 'GET') return json(res, 200, await db.getDashboard());
    if (req.method === 'DELETE') {
      await db.deleteRecord(query(req).get('type'), query(req).get('id'));
      return json(res, 200, { ok: true });
    }
    const body = await readJson(req);
    if (!body || typeof body !== 'object') return json(res, 400, { error: '입력 내용을 확인하세요.' });
    if (body.action === 'reveal' && req.method === 'POST') return json(res, 200, { secret: await db.revealAccount(body.id) });
    if (body.action === 'reorder' && req.method === 'PATCH') {
      await db.reorderTask(body.id, body.beforeId);
      return json(res, 200, { ok: true });
    }
    const item = req.method === 'POST' ? await db.createRecord(body.type, body) : await db.updateRecord(body.type, body.id, body);
    return json(res, req.method === 'POST' ? 201 : 200, { item });
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message });
    throw e;
  }
}
export default route({ GET: run, POST: run, PATCH: run, DELETE: run });
