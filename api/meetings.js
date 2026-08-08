// 회의록 API
// GET    /api/meetings?project=x            → 목록(본문 제외)
// GET    /api/meetings?project=x&id=Y       → 단일 회의록(본문 포함)
// POST   /api/meetings?project=x            → 생성 {title?, date?}
// PATCH  /api/meetings?project=x            → 메타 수정 {id, title?, date?}
// PUT    /api/meetings?project=x            → 본문 저장 {id, body, baseVersion} — 낙관적 잠금
// DELETE /api/meetings?project=x&id=Y       → 삭제
import { route, readJson, json, query } from '../lib/http.js';
import { requireProject } from '../lib/auth.js';
import * as store from '../lib/store.js';

export default route({
  async GET(req, res) {
    const project = requireProject(req, res);
    if (!project) return;

    // 본문에 삽입된 이미지 원본 서빙 (<img src>에서 직접 로드)
    const imageId = query(req).get('imageId');
    if (imageId) {
      const dataUrl = await store.getScreenshot(project.id, imageId);
      const m = dataUrl && /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
      if (!m) return json(res, 404, { error: '이미지를 찾을 수 없습니다.' });
      const buf = Buffer.from(m[2], 'base64');
      res.statusCode = 200;
      res.setHeader('Content-Type', m[1]);
      res.setHeader('Content-Length', buf.length);
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      return res.end(buf);
    }

    const id = query(req).get('id');
    if (id) {
      const m = await store.getMeeting(project.id, id);
      if (!m) return json(res, 404, { error: '존재하지 않는 회의록입니다.' });
      return json(res, 200, { meeting: m });
    }
    json(res, 200, { meetings: await store.listMeetings(project.id) });
  },

  async POST(req, res) {
    const project = requireProject(req, res);
    if (!project) return;
    const body = await readJson(req);

    // 이미지 업로드: { image: dataUrl } → { imageId }
    if (body && typeof body.image === 'string') {
      try {
        const imageId = await store.saveImage(project.id, body.image);
        return json(res, 201, { imageId });
      } catch (err) {
        if (err && err.status === 400) return json(res, 400, { error: err.message });
        throw err;
      }
    }

    const meeting = await store.createMeeting(project.id, body || {});
    json(res, 201, { meeting });
  },

  async PATCH(req, res) {
    const project = requireProject(req, res);
    if (!project) return;
    const body = await readJson(req);
    if (!body?.id) return json(res, 400, { error: '회의록 id가 필요합니다.' });
    const m = await store.updateMeetingMeta(project.id, body.id, body);
    if (!m) return json(res, 404, { error: '존재하지 않는 회의록입니다.' });
    // 메타 변경은 본문 version에는 영향 없음. 메타 조회용으로 body 제외해 반환.
    const { body: _b, ...meta } = m;
    json(res, 200, { meeting: meta });
  },

  async PUT(req, res) {
    const project = requireProject(req, res);
    if (!project) return;
    const body = await readJson(req);
    if (!body?.id) return json(res, 400, { error: '회의록 id가 필요합니다.' });
    const result = await store.saveMeetingBody(project.id, body.id, {
      body: body.body,
      baseVersion: Number.isInteger(body.baseVersion) ? body.baseVersion : null,
      updatedBy: body.updatedBy,
    });
    if (result.notFound) return json(res, 404, { error: '존재하지 않는 회의록입니다.' });
    if (result.badInput) return json(res, 400, { error: result.badInput });
    if (result.conflict) return json(res, 409, { conflict: true, meeting: result.meeting });
    json(res, 200, { meeting: result.meeting });
  },

  async DELETE(req, res) {
    const project = requireProject(req, res);
    if (!project) return;
    const id = query(req).get('id');
    if (!id) return json(res, 400, { error: '회의록 id가 필요합니다.' });
    await store.deleteMeeting(project.id, id);
    json(res, 200, { ok: true });
  },
});
