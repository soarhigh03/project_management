// 버그 API (요청마다 ?project= 필수, 세션 검증)
// GET    /api/bugs?project=x           → 목록
// POST   /api/bugs?project=x           → 생성
// PATCH  /api/bugs?project=x           → 수정 {num, ...변경 필드}
// DELETE /api/bugs?project=x&num=N     → 삭제
import { route, readJson, json, query } from '../lib/http.js';
import { requireProject } from '../lib/auth.js';
import * as store from '../lib/store.js';

function fail(res, err) {
  if (err && err.status === 400) return json(res, 400, { error: err.message });
  throw err;
}

export default route({
  async GET(req, res) {
    const project = requireProject(req, res);
    if (!project) return;
    json(res, 200, { bugs: await store.listBugs(project.id) });
  },

  async POST(req, res) {
    const project = requireProject(req, res);
    if (!project) return;
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: '잘못된 요청입니다.' });
    try {
      json(res, 201, { bug: await store.createBug(project.id, body) });
    } catch (err) { fail(res, err); }
  },

  async PATCH(req, res) {
    const project = requireProject(req, res);
    if (!project) return;
    const body = await readJson(req);
    const num = Number(body?.num);
    if (!Number.isInteger(num)) return json(res, 400, { error: '버그 번호가 필요합니다.' });
    try {
      const bug = await store.updateBug(project.id, num, body);
      if (!bug) return json(res, 404, { error: '존재하지 않는 버그입니다.' });
      json(res, 200, { bug });
    } catch (err) { fail(res, err); }
  },

  async DELETE(req, res) {
    const project = requireProject(req, res);
    if (!project) return;
    const num = Number(query(req).get('num'));
    if (!Number.isInteger(num)) return json(res, 400, { error: '버그 번호가 필요합니다.' });
    await store.deleteBug(project.id, num);
    json(res, 200, { ok: true });
  },
});
