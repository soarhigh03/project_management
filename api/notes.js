import { route, readJson, json, query } from '../lib/http.js';
import { requireProject } from '../lib/auth.js';
import { getRecord } from '../lib/dashboard.js';
import { syncNote } from '../lib/note-sync.js';
import { saveImage, getScreenshot } from '../lib/store.js';

async function handler(req, res) {
  const project = requireProject(req, res);
  if (!project) return;
  if (project.id !== 'patz') return json(res, 403, { error: 'PATZ 팀 로그인이 필요합니다.' });
  try {
    if (req.method === 'GET') {
      const imageId = query(req).get('imageId');
      if (imageId) {
        const data = await getScreenshot('patz', imageId);
        const match = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.*)$/s.exec(data || '');
        if (!match) return json(res, 404, { error: '이미지를 찾을 수 없습니다.' });
        res.setHeader('Content-Type', match[1]);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.end(Buffer.from(match[2], 'base64'));
      }
      const id = query(req).get('id');
      const note = await getRecord('notes', id);
      if (!note) return json(res, 404, { error: '회의록을 찾을 수 없습니다.' });
      return json(res, 200, { note, ...await syncNote(id) });
    }
    const body = await readJson(req, 4 * 1024 * 1024);
    if (!body) return json(res, 400, { error: '입력 내용을 확인하세요.' });
    if (body.image) return json(res, 201, { imageId: await saveImage('patz', body.image) });
    return json(res, 200, await syncNote(body.id, body));
  } catch (e) { if (e.status) return json(res, e.status, { error: e.message }); throw e; }
}
export default route({ GET: handler, POST: handler });
