// 기능 페이지: 언리얼 블루프린트 스타일 노드 그래프
//  - 잡(작업) = 노드, 태스크(할 일) = 노드 안 체크리스트
//  - 간선 = 의존성 (왼쪽 점 = 입력, 오른쪽 점 = 출력; 출력→입력으로 드래그해 연결)
window.TT = window.TT || {};
TT.pages = TT.pages || {};

TT.pages.features = async function (main, project) {
  const NODE_W = 240;
  const PORT_Y = 20; // 노드 상단에서 포트 중심까지

  let jobs = [];   // {id,title,assignee,x,y,tasks:[{id,title,assignee,done}]}
  let edges = [];  // {id,from,to}
  const view = { x: 60, y: 40, z: 1 };
  let selEdge = null;      // 선택된 간선 id
  let draft = null;        // 간선 드래그 중 {from, mx, my}
  let dragging = null;     // 노드 드래그 중
  let interacting = false; // 폴링 억제 플래그
  let focusAddJob = null;  // 재렌더 후 포커스 복원할 잡 id

  main.innerHTML = `
    <div class="feat-page">
      <div class="feat-toolbar">
        <button class="btn primary" id="addJob">+ 작업 추가</button>
        <button class="btn" id="fitBtn">화면 맞춤</button>
        <span class="feat-hint">💡 빈 곳 더블클릭: 작업 추가 · 오른쪽 점→왼쪽 점 드래그: 의존성 연결 · 선 클릭: 연결 삭제 · 휠: 확대/축소</span>
      </div>
      <div class="canvas" id="canvas">
        <div class="world" id="world">
          <svg class="edges" id="edgeSvg" width="20000" height="20000"
               viewBox="-10000 -10000 20000 20000"
               style="left:-10000px; top:-10000px"></svg>
          <div id="nodes"></div>
        </div>
      </div>
    </div>`;

  const canvas = main.querySelector('#canvas');
  const world = main.querySelector('#world');
  const edgeSvg = main.querySelector('#edgeSvg');
  const nodesEl = main.querySelector('#nodes');

  const jobById = (id) => jobs.find((j) => j.id === id);
  const jobDone = (j) => j.tasks.length > 0 && j.tasks.every((t) => t.done);
  const jobBlocked = (j) => edges.some((e) => e.to === j.id && jobById(e.from) && !jobDone(jobById(e.from)));

  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  }

  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
  }

  // ---------- 서버 연동 ----------
  async function op(body) {
    try {
      const g = await TT.api('POST', `/api/features?project=${project.id}`, body);
      setGraph(g);
    } catch (ex) {
      TT.toast(ex.message, true);
      await load(); // 서버 상태와 다시 동기화
    }
  }

  function setGraph(g) {
    jobs = g.jobs;
    edges = g.edges;
    if (selEdge && !edges.some((e) => e.id === selEdge)) selEdge = null;
    render();
  }

  async function load() {
    try { setGraph(await TT.api('GET', `/api/features?project=${project.id}`)); }
    catch (ex) { TT.toast(ex.message, true); }
  }

  // ---------- 간선 그리기 ----------
  function portPos(job, kind) {
    return kind === 'out'
      ? { x: job.x + NODE_W, y: job.y + PORT_Y }
      : { x: job.x, y: job.y + PORT_Y };
  }

  function bezier(a, b) {
    const dx = Math.max(50, Math.abs(b.x - a.x) * 0.55);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }

  function renderEdges() {
    let html = '';
    for (const e of edges) {
      const from = jobById(e.from), to = jobById(e.to);
      if (!from || !to) continue;
      const d = bezier(portPos(from, 'out'), portPos(to, 'in'));
      const cls = [jobDone(from) ? 'done' : '', selEdge === e.id ? 'sel' : ''].join(' ');
      html += `<g class="${cls}" data-edge="${e.id}">
        <path class="edge-line" d="${d}"></path>
        <path class="edge-hit" d="${d}"></path>
      </g>`;
    }
    if (draft) {
      const from = jobById(draft.from);
      if (from) {
        html += `<g><path class="edge-line" stroke-dasharray="6 5" d="${bezier(portPos(from, 'out'), { x: draft.mx, y: draft.my })}"></path></g>`;
      }
    }
    edgeSvg.innerHTML = html;

    edgeSvg.querySelectorAll('.edge-hit').forEach((p) => {
      p.onclick = (e) => {
        e.stopPropagation();
        selEdge = (selEdge === p.parentNode.dataset.edge) ? null : p.parentNode.dataset.edge;
        render();
      };
    });

    // 선택된 간선 중간에 삭제 버튼
    main.querySelectorAll('.edge-del').forEach((b) => b.remove());
    if (selEdge) {
      const e = edges.find((x) => x.id === selEdge);
      const from = e && jobById(e.from), to = e && jobById(e.to);
      if (from && to) {
        const a = portPos(from, 'out'), bb = portPos(to, 'in');
        const btn = document.createElement('button');
        btn.className = 'edge-del';
        btn.textContent = '✕';
        btn.title = '연결 삭제';
        btn.style.left = (a.x + bb.x) / 2 + 'px';
        btn.style.top = (a.y + bb.y) / 2 + 'px';
        btn.onclick = () => { const id = selEdge; selEdge = null; op({ op: 'deleteEdge', edgeId: id }); };
        world.appendChild(btn);
      }
    }
  }

  // ---------- 노드 그리기 ----------
  function jobBadge(j) {
    if (jobDone(j)) return '<span class="job-badge b-done">완료</span>';
    if (jobBlocked(j)) return '<span class="job-badge b-blocked">선행 대기</span>';
    if (j.tasks.some((t) => t.done)) return '<span class="job-badge b-ready">진행 중</span>';
    return '<span class="job-badge b-ready">시작 전</span>';
  }

  function memberOptions(sel) {
    return `<option value="">미지정</option>` +
      project.members.map((m) => `<option value="${TT.esc(m)}" ${m === sel ? 'selected' : ''}>${TT.esc(m)}</option>`).join('');
  }

  function renderJob(j) {
    const el = document.createElement('div');
    el.className = 'job' + (jobDone(j) ? ' done' : jobBlocked(j) ? ' blocked' : '');
    el.style.left = j.x + 'px';
    el.style.top = j.y + 'px';
    el.dataset.id = j.id;
    const doneCount = j.tasks.filter((t) => t.done).length;
    const pct = j.tasks.length ? Math.round((doneCount / j.tasks.length) * 100) : 0;

    el.innerHTML = `
      <div class="port in" title="선행 작업 연결 (입력)"></div>
      <div class="port out" title="드래그해서 다음 작업에 연결 (출력)"></div>
      <div class="job-head">
        <span class="job-title" title="더블클릭으로 이름 변경">${TT.esc(j.title)}</span>
        ${jobBadge(j)}
        <button class="job-x" title="작업 삭제">✕</button>
      </div>
      <div class="job-assign">
        <span class="lbl">담당</span>
        <select class="j-assignee">${memberOptions(j.assignee)}</select>
      </div>
      <div class="tasks">
        ${j.tasks.map((t) => `
          <div class="task ${t.done ? 'done' : ''}" data-task="${t.id}">
            <input type="checkbox" ${t.done ? 'checked' : ''} title="완료 체크">
            <span class="t-title" title="더블클릭으로 수정">${TT.esc(t.title)}</span>
            <select class="t-assignee" title="담당자">${memberOptions(t.assignee)}</select>
            <button class="t-x" title="삭제">✕</button>
          </div>`).join('')}
      </div>
      <div class="job-add"><input type="text" placeholder="+ 할 일 추가 (Enter)" maxlength="300"></div>
      <div class="progress"><div style="width:${pct}%"></div></div>`;

    // ----- 노드 드래그 (헤더) -----
    const head = el.querySelector('.job-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, input, select')) return;
      if (e.button !== 0) return;
      e.preventDefault();
      const start = toWorld(e.clientX, e.clientY);
      dragging = { job: j, el, dx: start.x - j.x, dy: start.y - j.y, moved: false };
      interacting = true;
      el.classList.add('dragging');
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!dragging || dragging.job !== j) return;
      const p = toWorld(e.clientX, e.clientY);
      j.x = Math.round(p.x - dragging.dx);
      j.y = Math.round(p.y - dragging.dy);
      dragging.moved = true;
      el.style.left = j.x + 'px';
      el.style.top = j.y + 'px';
      renderEdges();
    });
    head.addEventListener('pointerup', () => {
      if (!dragging || dragging.job !== j) return;
      el.classList.remove('dragging');
      const moved = dragging.moved;
      dragging = null;
      interacting = false;
      if (moved) {
        // 위치만 저장 (그래프 응답 렌더 생략용으로 fire-and-forget)
        TT.api('POST', `/api/features?project=${project.id}`, { op: 'updateJob', jobId: j.id, x: j.x, y: j.y })
          .catch((ex) => TT.toast(ex.message, true));
      }
    });

    // ----- 제목 인라인 수정 -----
    const titleEl = el.querySelector('.job-title');
    titleEl.ondblclick = () => {
      interacting = true;
      const input = document.createElement('input');
      input.className = 'job-title-input';
      input.value = j.title;
      input.maxLength = 200;
      titleEl.replaceWith(input);
      input.focus(); input.select();
      const commit = () => {
        interacting = false;
        const v = input.value.trim();
        if (v && v !== j.title) op({ op: 'updateJob', jobId: j.id, title: v });
        else render();
      };
      input.onblur = commit;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.value = j.title; input.blur(); }
      };
    };

    // ----- 잡 삭제 (2단 확인) -----
    const xBtn = el.querySelector('.job-x');
    xBtn.onclick = () => {
      if (xBtn.dataset.armed) { op({ op: 'deleteJob', jobId: j.id }); return; }
      xBtn.dataset.armed = '1';
      xBtn.textContent = '삭제?';
      xBtn.style.color = 'var(--red)';
      setTimeout(() => { xBtn.dataset.armed = ''; xBtn.textContent = '✕'; xBtn.style.color = ''; }, 2500);
    };

    // ----- 잡 담당자 -----
    el.querySelector('.j-assignee').onchange = (e) =>
      op({ op: 'updateJob', jobId: j.id, assignee: e.target.value });

    // ----- 태스크 상호작용 -----
    el.querySelectorAll('.task').forEach((tEl) => {
      const tid = tEl.dataset.task;
      const task = j.tasks.find((t) => t.id === tid);
      tEl.querySelector('input[type=checkbox]').onchange = (e) =>
        op({ op: 'updateTask', jobId: j.id, taskId: tid, done: e.target.checked });
      tEl.querySelector('.t-assignee').onchange = (e) =>
        op({ op: 'updateTask', jobId: j.id, taskId: tid, assignee: e.target.value });
      tEl.querySelector('.t-x').onclick = () =>
        op({ op: 'deleteTask', jobId: j.id, taskId: tid });
      tEl.querySelector('.t-title').ondblclick = () => {
        interacting = true;
        const span = tEl.querySelector('.t-title');
        const input = document.createElement('input');
        input.className = 't-edit';
        input.type = 'text';
        input.value = task.title;
        input.maxLength = 300;
        span.replaceWith(input);
        input.focus(); input.select();
        const commit = () => {
          interacting = false;
          const v = input.value.trim();
          if (v && v !== task.title) op({ op: 'updateTask', jobId: j.id, taskId: tid, title: v });
          else render();
        };
        input.onblur = commit;
        input.onkeydown = (e) => {
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') { input.value = task.title; input.blur(); }
        };
      };
    });

    // ----- 할 일 추가 -----
    const addInput = el.querySelector('.job-add input');
    addInput.onfocus = () => { interacting = true; };
    addInput.onblur = () => { interacting = false; };
    addInput.onkeydown = (e) => {
      if (e.key === 'Enter' && addInput.value.trim()) {
        focusAddJob = j.id;
        op({ op: 'addTask', jobId: j.id, title: addInput.value.trim(), assignee: TT.me() });
      }
    };

    // ----- 간선 연결 (출력 포트에서 드래그) -----
    el.querySelector('.port.out').addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const p = toWorld(e.clientX, e.clientY);
      draft = { from: j.id, mx: p.x, my: p.y };
      interacting = true;
      renderEdges();
    });
    // 입력 포트/노드 위에서 드롭
    el.addEventListener('pointerup', () => {
      if (draft && draft.from !== j.id) {
        const from = draft.from;
        draft = null;
        interacting = false;
        op({ op: 'addEdge', from, to: j.id });
      }
    });

    return el;
  }

  function render() {
    nodesEl.innerHTML = '';
    for (const j of jobs) nodesEl.appendChild(renderJob(j));
    renderEdges();
    applyView();
    if (jobs.length === 0) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.style.cssText = 'position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);width:max-content';
      note.innerHTML = '아직 작업이 없습니다.<br>“+ 작업 추가” 버튼이나 빈 곳 더블클릭으로 시작하세요.';
      nodesEl.appendChild(note);
    }
    if (focusAddJob) {
      const inp = nodesEl.querySelector(`.job[data-id="${focusAddJob}"] .job-add input`);
      focusAddJob = null;
      if (inp) inp.focus();
    }
  }

  // ---------- 캔버스 팬/줌/간선 드래프트 ----------
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.job, .edge-del, path.edge-hit')) return;
    if (e.button !== 0 && e.button !== 1) return;
    const start = { mx: e.clientX, my: e.clientY, vx: view.x, vy: view.y, moved: false };
    canvas.classList.add('panning');
    canvas.setPointerCapture(e.pointerId);
    const move = (ev) => {
      start.moved = start.moved || Math.abs(ev.clientX - start.mx) + Math.abs(ev.clientY - start.my) > 3;
      view.x = start.vx + (ev.clientX - start.mx);
      view.y = start.vy + (ev.clientY - start.my);
      applyView();
    };
    const up = () => {
      canvas.classList.remove('panning');
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      if (!start.moved && selEdge) { selEdge = null; render(); } // 빈 곳 클릭 → 선택 해제
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!draft) return;
    const p = toWorld(e.clientX, e.clientY);
    draft.mx = p.x; draft.my = p.y;
    renderEdges();
    // 드롭 대상 하이라이트
    nodesEl.querySelectorAll('.port.in').forEach((port) => {
      const jid = port.closest('.job').dataset.id;
      port.classList.toggle('hot', jid !== draft.from && port.closest('.job').matches(':hover'));
    });
  });

  canvas.addEventListener('pointerup', () => {
    if (draft) { draft = null; interacting = false; renderEdges(); }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nz = Math.min(2, Math.max(0.35, view.z * factor));
    // 커서 위치 고정 줌
    view.x = mx - ((mx - view.x) / view.z) * nz;
    view.y = my - ((my - view.y) / view.z) * nz;
    view.z = nz;
    applyView();
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    if (e.target.closest('.job, .edge-del')) return;
    const p = toWorld(e.clientX, e.clientY);
    op({ op: 'addJob', title: '새 작업', x: p.x - NODE_W / 2, y: p.y - 20, assignee: TT.me() });
  });

  main.querySelector('#addJob').onclick = () => {
    const p = toWorld(canvas.clientWidth / 2 + canvas.getBoundingClientRect().left, 200 + canvas.getBoundingClientRect().top);
    op({ op: 'addJob', title: '새 작업', x: p.x - NODE_W / 2, y: p.y, assignee: TT.me() });
  };

  main.querySelector('#fitBtn').onclick = () => {
    if (!jobs.length) return;
    const minX = Math.min(...jobs.map((j) => j.x)) - 60;
    const minY = Math.min(...jobs.map((j) => j.y)) - 60;
    const maxX = Math.max(...jobs.map((j) => j.x + NODE_W)) + 60;
    const maxY = Math.max(...jobs.map((j) => j.y + 220)) + 60;
    const z = Math.min(1.2, canvas.clientWidth / (maxX - minX), canvas.clientHeight / (maxY - minY));
    view.z = Math.max(0.35, z);
    view.x = (canvas.clientWidth - (maxX - minX) * view.z) / 2 - minX * view.z;
    view.y = (canvas.clientHeight - (maxY - minY) * view.z) / 2 - minY * view.z;
    applyView();
  };

  // ---------- 로드 + 폴링 ----------
  await load();
  if (jobs.length) main.querySelector('#fitBtn').click();

  const timer = setInterval(() => {
    if (document.hidden || interacting || dragging || draft) return;
    if (main.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
    load();
  }, 15000);

  return () => clearInterval(timer);
};
