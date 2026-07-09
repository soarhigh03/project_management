// GET    /api/auth?project=x  → 세션 확인 + 프로젝트 공개 정보
// POST   /api/auth            → 로그인 {project, password}
// DELETE /api/auth            → 로그아웃
import { route, readJson, json, query } from '../lib/http.js';
import { getProject, publicProject } from '../lib/config.js';
import { verifyPassword, grantProject, clearSession, readSession, rateLimitOk } from '../lib/auth.js';

export default route({
  async GET(req, res) {
    const id = query(req).get('project');
    const project = getProject(id);
    if (!project) return json(res, 404, { error: '존재하지 않는 프로젝트입니다.' });
    const sess = readSession(req);
    if (!sess || !sess.ps.includes(id)) return json(res, 401, { error: '로그인이 필요합니다.' });
    json(res, 200, { project: publicProject(project) });
  },

  async POST(req, res) {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: '잘못된 요청입니다.' });
    const project = getProject(body.project);
    if (!project) return json(res, 404, { error: '존재하지 않는 프로젝트입니다.' });
    if (!rateLimitOk(req, project.id)) {
      return json(res, 429, { error: '시도 횟수가 너무 많습니다. 10분 후 다시 시도하세요.' });
    }
    if (!verifyPassword(String(body.password ?? ''), project.passwordHash)) {
      return json(res, 401, { error: '비밀번호가 올바르지 않습니다.' });
    }
    grantProject(req, res, project.id);
    json(res, 200, { project: publicProject(project) });
  },

  async DELETE(req, res) {
    clearSession(req, res);
    json(res, 200, { ok: true });
  },
});
