// 앱 셸: URL 파싱 → 세션 확인 → 탭(버그/기능) 전환 + "나" 선택
(async function () {
  // URL: /p/{projectId}/{tab}
  const m = location.pathname.match(/^\/p\/([a-z0-9-]+)(?:\/(bugs|features))?/);
  if (!m) { location.href = '/'; return; }
  const projectId = m[1];
  let tab = m[2] || 'bugs';

  let project;
  try {
    ({ project } = await TT.api('GET', `/api/auth?project=${encodeURIComponent(projectId)}`));
  } catch {
    location.href = '/';
    return;
  }

  TT.project = project;
  document.title = `${project.name} — TaskTrack`;
  document.getElementById('projName').textContent = project.name;
  document.body.classList.remove('preauth');

  // ---- "나" (담당자 필터/기본값에 사용, localStorage에 기억) ----
  const meKey = `tt_me:${project.id}`;
  const meSelect = document.getElementById('meSelect');
  for (const name of project.members) {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    meSelect.appendChild(o);
  }
  meSelect.value = localStorage.getItem(meKey) || '';
  if (meSelect.value === '' && localStorage.getItem(meKey)) localStorage.removeItem(meKey);
  TT.me = () => meSelect.value;
  meSelect.onchange = () => {
    localStorage.setItem(meKey, meSelect.value);
    document.dispatchEvent(new CustomEvent('tt:me-changed'));
  };

  document.getElementById('logoutBtn').onclick = async () => {
    await TT.api('DELETE', '/api/auth').catch(() => {});
    location.href = '/';
  };

  // ---- 탭 전환 ----
  const main = document.getElementById('main');
  const tabs = document.querySelectorAll('.tab');
  let destroyCurrent = null;

  async function show(next, push) {
    if (destroyCurrent) { destroyCurrent(); destroyCurrent = null; }
    tab = next;
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    if (push) history.pushState({}, '', `/p/${project.id}/${tab}`);
    main.innerHTML = '';
    destroyCurrent = tab === 'bugs'
      ? await TT.pages.bugs(main, project)
      : await TT.pages.features(main, project);
  }

  tabs.forEach((t) => { t.onclick = () => show(t.dataset.tab, true); });
  window.onpopstate = () => {
    const mm = location.pathname.match(/\/(bugs|features)$/);
    show(mm ? mm[1] : 'bugs', false);
  };

  await show(tab, false);
})();
