// 버그 페이지: 목록 + 필터 + 생성/수정 모달
window.TT = window.TT || {};
TT.pages = TT.pages || {};

TT.pages.bugs = async function (main, project) {
  const STATES = [
    { id: 'todo', name: '시작 전' },
    { id: 'doing', name: '진행 중' },
    { id: 'waiting', name: '대기 중' },
    { id: 'done', name: '해결됨' },
  ];
  const stateName = (id) => (STATES.find((s) => s.id === id) || STATES[0]).name;
  const urgName = (id) => (project.urgencies.find((u) => u.id === id) || { name: id }).name;

  let bugs = [];
  const filters = { mine: false, open: false, region: '', urgency: '', state: '', q: '' };

  main.innerHTML = `
    <div class="bugs-page">
      <div class="bug-toolbar">
        <button class="btn primary" id="newBug">+ 버그 신고</button>
        <input type="text" id="fQ" placeholder="검색 (제목/설명/#번호)">
        <span class="toggle-chip" id="fMine">내 것만</span>
        <span class="toggle-chip" id="fOpen">미해결만</span>
        <select id="fRegion"><option value="">영역: 전체</option>${project.regions.map((r) => `<option value="${TT.esc(r)}">${TT.esc(r)}</option>`).join('')}</select>
        <select id="fUrg"><option value="">긴급도: 전체</option>${project.urgencies.map((u) => `<option value="${u.id}">${TT.esc(u.name)}</option>`).join('')}</select>
        <select id="fState"><option value="">상태: 전체</option>${STATES.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
        <span class="bug-count" id="count"></span>
      </div>
      <div class="bug-list">
        <table class="bugs">
          <thead><tr>
            <th style="width:52px">#</th><th>제목</th><th style="width:90px" class="hide-sm">영역</th>
            <th style="width:80px">긴급도</th><th style="width:110px">상태</th>
            <th style="width:110px">담당자</th><th style="width:90px" class="hide-sm">마감일</th>
          </tr></thead>
          <tbody id="rows"></tbody>
        </table>
        <div class="empty-note" id="empty" style="display:none"></div>
      </div>
    </div>`;

  const $ = (id) => main.querySelector('#' + id);

  // ---------- 필터 ----------
  function visible() {
    const q = filters.q.toLowerCase();
    return bugs.filter((b) => {
      if (filters.mine && b.assignee !== TT.me()) return false;
      if (filters.open && b.state === 'done') return false;
      if (filters.region && b.region !== filters.region) return false;
      if (filters.urgency && b.urgency !== filters.urgency) return false;
      if (filters.state && b.state !== filters.state) return false;
      if (q && !(`#${b.num} ${b.title} ${b.desc} ${b.assignee} ${b.reporter}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  $('fQ').oninput = (e) => { filters.q = e.target.value; renderRows(); };
  $('fMine').onclick = (e) => { filters.mine = !filters.mine; e.target.classList.toggle('on', filters.mine); renderRows(); };
  $('fOpen').onclick = (e) => { filters.open = !filters.open; e.target.classList.toggle('on', filters.open); renderRows(); };
  $('fRegion').onchange = (e) => { filters.region = e.target.value; renderRows(); };
  $('fUrg').onchange = (e) => { filters.urgency = e.target.value; renderRows(); };
  $('fState').onchange = (e) => { filters.state = e.target.value; renderRows(); };
  const onMe = () => { if (filters.mine) renderRows(); };
  document.addEventListener('tt:me-changed', onMe);

  // ---------- 목록 렌더 ----------
  function renderRows() {
    const list = visible();
    const tbody = $('rows');
    $('count').textContent = `${list.length}건`;
    $('empty').style.display = list.length ? 'none' : '';
    $('empty').textContent = bugs.length ? '조건에 맞는 버그가 없습니다.' : '아직 신고된 버그가 없습니다. 첫 버그를 신고해 보세요!';
    const today = TT.todayStr();

    tbody.innerHTML = list.map((b) => {
      const overdue = b.due && b.due < today && b.state !== 'done';
      return `
      <tr class="bug-row ${b.state === 'done' ? 'bug-done' : ''}" data-num="${b.num}">
        <td class="bug-num">#${b.num}</td>
        <td class="bug-title">${TT.esc(b.title)}${b.desc ? `<span class="bug-desc-preview">${TT.esc(b.desc)}</span>` : ''}</td>
        <td class="hide-sm">${TT.esc(b.region)}</td>
        <td><span class="chip u-${TT.esc(b.urgency)}"><span class="dot"></span>${TT.esc(urgName(b.urgency))}</span></td>
        <td>
          <select class="mini-select s-${b.state}" data-quick="state" data-num="${b.num}">
            ${STATES.map((s) => `<option value="${s.id}" ${s.id === b.state ? 'selected' : ''}>${s.name}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="mini-select" data-quick="assignee" data-num="${b.num}">
            <option value="">미지정</option>
            ${project.members.map((mname) => `<option value="${TT.esc(mname)}" ${mname === b.assignee ? 'selected' : ''}>${TT.esc(mname)}</option>`).join('')}
          </select>
        </td>
        <td class="due-cell ${overdue ? 'overdue' : ''} hide-sm">${TT.fmtDate(b.due)}</td>
      </tr>`;
    }).join('');

    // 행 클릭 → 수정 모달 (인라인 select 클릭은 제외)
    tbody.querySelectorAll('tr.bug-row').forEach((tr) => {
      tr.onclick = (e) => {
        if (e.target.closest('select')) return;
        const bug = bugs.find((b) => b.num === Number(tr.dataset.num));
        if (bug) openModal(bug);
      };
    });
    // 인라인 빠른 변경 (상태/담당자)
    tbody.querySelectorAll('select[data-quick]').forEach((sel) => {
      sel.onchange = async () => {
        const num = Number(sel.dataset.num);
        try {
          const { bug } = await TT.api('PATCH', `/api/bugs?project=${project.id}`, { num, [sel.dataset.quick]: sel.value });
          bugs = bugs.map((b) => (b.num === num ? bug : b));
          renderRows();
        } catch (ex) { TT.toast(ex.message, true); load(); }
      };
    });
  }

  // ---------- 생성/수정 모달 ----------
  function openModal(bug) {
    const isNew = !bug;
    const b = bug || {
      title: '', desc: '', region: project.regions[0] || '', urgency: 'mid',
      state: 'todo', assignee: '', due: '',
    };
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal">
        <h3>${isNew ? '버그 신고' : `#${b.num} 수정`}</h3>
        <div class="grid">
          <div class="field full"><label>제목 *</label><input type="text" id="mTitle" value="${TT.esc(b.title)}" maxlength="200"></div>
          <div class="field full"><label>설명</label><textarea id="mDesc">${TT.esc(b.desc)}</textarea></div>
          <div class="field"><label>영역 (페이지)</label>
            <select id="mRegion">${project.regions.map((r) => `<option ${r === b.region ? 'selected' : ''}>${TT.esc(r)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>상태</label>
            <select id="mState">${STATES.map((s) => `<option value="${s.id}" ${s.id === b.state ? 'selected' : ''}>${s.name}</option>`).join('')}</select>
          </div>
          <div class="field full"><label>긴급도</label>
            <div class="chip-row" id="mUrg">
              ${project.urgencies.map((u) => `<span class="chip u-${u.id} ${u.id === b.urgency ? 'sel' : ''}" data-u="${u.id}"><span class="dot"></span>${TT.esc(u.name)}</span>`).join('')}
            </div>
          </div>
          <div class="field"><label>담당자</label>
            <select id="mAssignee"><option value="">미지정</option>${project.members.map((mn) => `<option ${mn === b.assignee ? 'selected' : ''}>${TT.esc(mn)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>마감일</label><input type="date" id="mDue" value="${TT.esc(b.due)}"></div>
        </div>
        ${isNew ? '' : `<p class="meta-line">등록: ${TT.esc(b.reporter || '?')} · ${new Date(b.createdAt).toLocaleString('ko-KR')}</p>`}
        <div class="modal-foot">
          ${isNew ? '' : '<button class="btn danger" id="mDel">삭제</button>'}
          <span class="grow"></span>
          <button class="btn" id="mCancel">취소</button>
          <button class="btn primary" id="mSave">${isNew ? '신고하기' : '저장'}</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const q = (id) => back.querySelector('#' + id);
    let urgency = b.urgency;

    back.onclick = (e) => { if (e.target === back) back.remove(); };
    q('mCancel').onclick = () => back.remove();
    q('mUrg').querySelectorAll('.chip').forEach((c) => {
      c.onclick = () => {
        urgency = c.dataset.u;
        q('mUrg').querySelectorAll('.chip').forEach((x) => x.classList.toggle('sel', x === c));
      };
    });
    q('mTitle').focus();

    if (!isNew) {
      let armed = false;
      q('mDel').onclick = async () => {
        if (!armed) { armed = true; q('mDel').textContent = '정말 삭제할까요?'; return; }
        try {
          await TT.api('DELETE', `/api/bugs?project=${project.id}&num=${b.num}`);
          bugs = bugs.filter((x) => x.num !== b.num);
          back.remove(); renderRows();
          TT.toast(`#${b.num} 삭제됨`);
        } catch (ex) { TT.toast(ex.message, true); }
      };
    }

    q('mSave').onclick = async () => {
      const payload = {
        title: q('mTitle').value,
        desc: q('mDesc').value,
        region: q('mRegion').value,
        state: q('mState').value,
        urgency,
        assignee: q('mAssignee').value,
        due: q('mDue').value,
      };
      q('mSave').disabled = true;
      try {
        if (isNew) {
          payload.reporter = TT.me() || '익명';
          const { bug: created } = await TT.api('POST', `/api/bugs?project=${project.id}`, payload);
          bugs.unshift(created);
          TT.toast(`#${created.num} 신고 완료`);
        } else {
          payload.num = b.num;
          const { bug: updated } = await TT.api('PATCH', `/api/bugs?project=${project.id}`, payload);
          bugs = bugs.map((x) => (x.num === b.num ? updated : x));
        }
        back.remove(); renderRows();
      } catch (ex) {
        TT.toast(ex.message, true);
        q('mSave').disabled = false;
      }
    };
  }

  $('newBug').onclick = () => openModal(null);

  // ---------- 데이터 로드 + 주기적 새로고침 ----------
  async function load() {
    try {
      ({ bugs } = await TT.api('GET', `/api/bugs?project=${project.id}`));
      renderRows();
    } catch (ex) { TT.toast(ex.message, true); }
  }
  await load();

  const timer = setInterval(() => {
    if (document.hidden || document.querySelector('.modal-back')) return;
    load();
  }, 20000);

  // 페이지 파괴자 반환 (탭 전환 시 정리)
  return () => {
    clearInterval(timer);
    document.removeEventListener('tt:me-changed', onMe);
  };
};
