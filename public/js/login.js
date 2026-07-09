// 로그인(프로젝트 선택) 화면
(async function () {
  const card = document.getElementById('card');
  const list = document.getElementById('projList');

  function pwView(projectId, projectName) {
    card.innerHTML = `
      <h2>${TT.esc(projectName || projectId)} — 비밀번호 입력</h2>
      <form class="pw-form" id="pwForm">
        <input type="password" id="pw" placeholder="프로젝트 비밀번호" autocomplete="current-password" autofocus>
        <p class="form-err" id="err"></p>
        <button class="btn primary" type="submit">입장</button>
        <button class="btn ghost" type="button" id="back">← 프로젝트 목록으로</button>
      </form>`;
    document.getElementById('back').onclick = () => location.reload();
    document.getElementById('pwForm').onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById('err');
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; err.textContent = '';
      try {
        await TT.api('POST', '/api/auth', {
          project: projectId,
          password: document.getElementById('pw').value,
        });
        location.href = `/p/${projectId}/bugs`;
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
      }
    };
    document.getElementById('pw').focus();
  }

  function idView() {
    card.innerHTML = `
      <h2>프로젝트 ID 직접 입력</h2>
      <form class="pw-form" id="idForm">
        <input type="text" id="pid" placeholder="프로젝트 ID (예: my-app)" autocomplete="off">
        <p class="form-err"></p>
        <button class="btn primary" type="submit">다음</button>
        <button class="btn ghost" type="button" id="back">← 돌아가기</button>
      </form>`;
    document.getElementById('back').onclick = () => location.reload();
    document.getElementById('idForm').onsubmit = (e) => {
      e.preventDefault();
      const id = document.getElementById('pid').value.trim();
      if (id) pwView(id, id);
    };
    document.getElementById('pid').focus();
  }

  document.getElementById('hiddenBtn').onclick = idView;

  try {
    const { projects } = await TT.api('GET', '/api/config');
    if (!projects.length) {
      list.innerHTML = '<div class="empty-note">공개된 프로젝트가 없습니다.<br>config/projects.js에 프로젝트를 추가하세요.</div>';
      return;
    }
    list.innerHTML = '';
    for (const p of projects) {
      const el = document.createElement('div');
      el.className = 'proj-item';
      el.innerHTML = `<span>${TT.esc(p.name)}</span><span class="arrow">→</span>`;
      el.onclick = async () => {
        // 이미 로그인된 프로젝트면 바로 입장
        try {
          await TT.api('GET', `/api/auth?project=${encodeURIComponent(p.id)}`);
          location.href = `/p/${p.id}/bugs`;
        } catch {
          pwView(p.id, p.name);
        }
      };
      list.appendChild(el);
    }
  } catch (e) {
    list.innerHTML = `<div class="empty-note">${TT.esc(e.message)}</div>`;
  }
})();
