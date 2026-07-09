// GET /api/config → 홈 화면용 공개 프로젝트 목록 (이름/ID만, 비밀 정보 없음)
import { route, json } from '../lib/http.js';
import { listedProjects } from '../lib/config.js';

export default route({
  async GET(req, res) {
    json(res, 200, { projects: listedProjects() });
  },
});
