// 기능 그래프 API (요청마다 ?project= 필수, 세션 검증)
// GET  /api/features?project=x → { jobs, edges }
// POST /api/features?project=x → { op, ... } 뮤테이션 후 최신 그래프 반환
//   op: addJob | updateJob | deleteJob | addTask | updateTask | deleteTask | addEdge | deleteEdge
import { route, readJson, json } from '../lib/http.js';
import { requireProject } from '../lib/auth.js';
import * as store from '../lib/store.js';

export default route({
  async GET(req, res) {
    const project = requireProject(req, res);
    if (!project) return;
    json(res, 200, await store.getGraph(project.id));
  },

  async POST(req, res) {
    const project = requireProject(req, res);
    if (!project) return;
    const body = await readJson(req);
    if (!body || typeof body.op !== 'string') return json(res, 400, { error: '잘못된 요청입니다.' });
    const p = project.id;
    try {
      switch (body.op) {
        case 'addJob': await store.addJob(p, body); break;
        case 'updateJob': await store.updateJob(p, body.jobId, body); break;
        case 'deleteJob': await store.deleteJob(p, body.jobId); break;
        case 'addTask': await store.addTask(p, body.jobId, body); break;
        case 'updateTask': await store.updateTask(p, body.jobId, body.taskId, body); break;
        case 'deleteTask': await store.deleteTask(p, body.jobId, body.taskId); break;
        case 'addEdge': await store.addEdge(p, body.from, body.to); break;
        case 'deleteEdge': await store.deleteEdge(p, body.edgeId); break;
        default: return json(res, 400, { error: '알 수 없는 작업입니다: ' + body.op });
      }
    } catch (err) {
      if (err && err.status === 400) return json(res, 400, { error: err.message });
      throw err;
    }
    json(res, 200, await store.getGraph(p));
  },
});
