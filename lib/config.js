// 프로젝트 설정 로더 — config/projects.js 파일 하나로 모든 프로젝트를 관리
import projects from '../config/projects.js';

const DEFAULT_URGENCIES = [
  { id: 'low', name: '낮음' },
  { id: 'mid', name: '보통' },
  { id: 'high', name: '높음' },
  { id: 'critical', name: '긴급' },
];

export function allProjects() {
  return projects;
}

export function getProject(id) {
  if (typeof id !== 'string') return null;
  return projects.find((p) => p.id === id) || null;
}

// 로그인 전 홈 화면에 노출해도 되는 최소 정보 (listed:false 프로젝트는 제외)
export function listedProjects() {
  return projects
    .filter((p) => p.listed !== false)
    .map((p) => ({ id: p.id, name: p.name }));
}

// 로그인 후 클라이언트에 내려줄 정보 — 비밀번호 해시는 절대 포함하지 않음
export function publicProject(p) {
  return {
    id: p.id,
    name: p.name,
    members: p.members || [],
    regions: p.regions || [],
    urgencies: p.urgencies || DEFAULT_URGENCIES,
  };
}

export function validateConfig() {
  const ids = new Set();
  for (const p of projects) {
    if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) throw new Error(`프로젝트 id가 잘못되었습니다: "${p.id}" (소문자/숫자/하이픈만 허용)`);
    if (ids.has(p.id)) throw new Error(`프로젝트 id 중복: ${p.id}`);
    ids.add(p.id);
    if (!p.passwordHash || !p.passwordHash.startsWith('scrypt:')) {
      throw new Error(`프로젝트 "${p.id}"의 passwordHash가 없거나 형식이 잘못되었습니다. npm run hash -- "비밀번호" 로 생성하세요.`);
    }
  }
  return true;
}
