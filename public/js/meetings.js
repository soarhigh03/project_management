// 회의록 페이지 — 노션 DB 스타일 테이블 + 마크다운 에디터
//   · 테이블: 회차/제목/날짜/수정 시각. 제목·날짜는 인라인 편집 가능.
//   · 상세: 좌측 마크다운 소스, 우측 실시간 렌더. 자동 저장 + 폴링으로 동시편집.
//   · 낙관적 잠금: baseVersion을 서버가 확인, 충돌 시 안내.
window.TT = window.TT || {};
TT.pages = TT.pages || {};

// ---------- 미니 마크다운 렌더러 (의존성 0) ----------
// 지원: # 헤더, **굵게**, *기울임*, `코드`, ```블록```, - / 1. 리스트, > 인용,
//       [텍스트](링크), --- 구분선, 개행/빈줄.
function mdRender(src) {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // 코드 블록 먼저 분리해서 placeholder로 치환
  const codes = [];
  src = src.replace(/```([\s\S]*?)```/g, (_, code) => {
    codes.push(`<pre><code>${esc(code.replace(/^\n/, ''))}</code></pre>`);
    return `\x00CODE${codes.length - 1}\x00`;
  });

  const lines = src.split('\n');
  const out = [];
  let listType = null; // 'ul' | 'ol' | null
  let quoteOpen = false;

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const closeQuote = () => { if (quoteOpen) { out.push('</blockquote>'); quoteOpen = false; } };

  function inline(t) {
    return esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => {
        const safe = /^(https?:|\/|#)/.test(url) ? url : '#';
        return `<a href="${safe}" target="_blank" rel="noopener">${txt}</a>`;
      });
  }

  for (const raw of lines) {
    const line = raw;
    if (/^\x00CODE\d+\x00$/.test(line.trim())) {
      closeList(); closeQuote();
      out.push(line.trim());
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      closeList(); closeQuote();
      out.push('<hr>');
      continue;
    }
    if (/^\s*$/.test(line)) {
      closeList(); closeQuote();
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList(); closeQuote();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ol || ul) {
      const kind = ol ? 'ol' : 'ul';
      if (listType && listType !== kind) closeList();
      if (!listType) { out.push(`<${kind}>`); listType = kind; }
      out.push(`<li>${inline((ol || ul)[1])}</li>`);
      closeQuote();
      continue;
    }
    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      closeList();
      if (!quoteOpen) { out.push('<blockquote>'); quoteOpen = true; }
      out.push(`<p>${inline(q[1])}</p>`);
      continue;
    }
    closeList(); closeQuote();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList(); closeQuote();

  // 코드 블록 복원
  return out.join('\n').replace(/\x00CODE(\d+)\x00/g, (_, i) => codes[+i]);
}

// ---------- 페이지 ----------
TT.pages.meetings = async function (main, project) {
  let meetings = [];
  let detailId = null;   // 열려 있는 회의록 id
  let destroyDetail = null;

  main.innerHTML = `
    <div class="meet-page">
      <div class="meet-toolbar">
        <button class="btn primary" id="newMeet">+ 회의록 추가</button>
        <span class="meet-hint" id="meetHint"></span>
      </div>
      <div class="meet-body" id="meetBody"></div>
    </div>`;

  const body = main.querySelector('#meetBody');
  const hint = main.querySelector('#meetHint');

  // ---------- 목록 로드 ----------
  async function loadList() {
    try {
      ({ meetings } = await TT.api('GET', `/api/meetings?project=${project.id}`));
      renderList();
    } catch (ex) { TT.toast(ex.message, true); }
  }

  function renderList() {
    hint.textContent = `${meetings.length}건`;
    if (!meetings.length) {
      body.innerHTML = `<div class="meet-list"><div class="empty-note">아직 회의록이 없습니다. “+ 회의록 추가”로 시작하세요.</div></div>`;
      return;
    }
    body.innerHTML = `
      <div class="meet-list">
      <table class="meet-table">
        <thead><tr>
          <th style="width:80px">#</th>
          <th>제목</th>
          <th style="width:130px">날짜</th>
          <th style="width:170px" class="hide-sm">수정</th>
          <th style="width:44px"></th>
        </tr></thead>
        <tbody>
          ${meetings.map((m) => `
            <tr class="meet-row" data-id="${m.id}">
              <td class="meet-num">제${m.num}차</td>
              <td class="meet-title-cell"><input type="text" class="meet-title-inp" value="${TT.esc(m.title)}" maxlength="200"></td>
              <td><input type="date" class="meet-date-inp" value="${TT.esc(m.date)}"></td>
              <td class="hide-sm meet-updated">${TT.esc(m.updatedBy || '')} · ${fmtWhen(m.updatedAt)}</td>
              <td><button class="btn ghost meet-del" title="삭제">✕</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`;

    body.querySelectorAll('.meet-row').forEach((tr) => {
      const id = tr.dataset.id;
      const titleInp = tr.querySelector('.meet-title-inp');
      const dateInp = tr.querySelector('.meet-date-inp');

      tr.querySelector('.meet-title-cell').onclick = (e) => {
        if (e.target === titleInp) return;
        openDetail(id);
      };
      tr.querySelector('.meet-num').onclick = () => openDetail(id);

      titleInp.onchange = async () => {
        try {
          await TT.api('PATCH', `/api/meetings?project=${project.id}`, {
            id, title: titleInp.value, updatedBy: TT.me(),
          });
          const m = meetings.find((x) => x.id === id);
          if (m) m.title = titleInp.value;
        } catch (ex) { TT.toast(ex.message, true); loadList(); }
      };
      dateInp.onchange = async () => {
        try {
          await TT.api('PATCH', `/api/meetings?project=${project.id}`, {
            id, date: dateInp.value, updatedBy: TT.me(),
          });
          const m = meetings.find((x) => x.id === id);
          if (m) m.date = dateInp.value;
        } catch (ex) { TT.toast(ex.message, true); loadList(); }
      };

      const delBtn = tr.querySelector('.meet-del');
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!delBtn.dataset.armed) {
          delBtn.dataset.armed = '1';
          delBtn.textContent = '삭제?';
          delBtn.classList.add('danger');
          setTimeout(() => { delBtn.dataset.armed = ''; delBtn.textContent = '✕'; delBtn.classList.remove('danger'); }, 2500);
          return;
        }
        try {
          await TT.api('DELETE', `/api/meetings?project=${project.id}&id=${encodeURIComponent(id)}`);
          meetings = meetings.filter((x) => x.id !== id);
          renderList();
        } catch (ex) { TT.toast(ex.message, true); }
      };
    });
  }

  function fmtWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const today = new Date();
    const same = d.toDateString() === today.toDateString();
    if (same) return `오늘 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ---------- 상세(에디터) ----------
  async function openDetail(id) {
    if (destroyDetail) { destroyDetail(); destroyDetail = null; }
    detailId = id;
    let meeting;
    try {
      ({ meeting } = await TT.api('GET', `/api/meetings?project=${project.id}&id=${encodeURIComponent(id)}`));
    } catch (ex) { TT.toast(ex.message, true); return; }

    body.innerHTML = `
      <div class="meet-detail">
        <div class="meet-detail-head">
          <button class="btn ghost" id="backList">← 목록으로</button>
          <span class="meet-title-lg">${TT.esc(meeting.title)}</span>
          <span class="meet-date-tag">${TT.esc(meeting.date || '')}</span>
          <span class="spacer"></span>
          <span class="meet-status" id="meetStatus">불러옴</span>
        </div>
        <div class="meet-editor">
          <textarea id="mdSrc" class="md-src" placeholder="# 회의 안건&#10;&#10;- 논의 사항&#10;- 결정 사항&#10;"></textarea>
          <div id="mdPrev" class="md-prev"></div>
        </div>
      </div>`;

    const srcEl = main.querySelector('#mdSrc');
    const prevEl = main.querySelector('#mdPrev');
    const statusEl = main.querySelector('#meetStatus');
    main.querySelector('#backList').onclick = () => { detailId = null; renderList(); loadList(); };

    srcEl.value = meeting.body || '';
    prevEl.innerHTML = mdRender(srcEl.value);

    let localVersion = meeting.version;
    let dirty = false;               // 아직 서버에 반영 안 된 로컬 변경
    let saving = false;
    let lastKeystroke = 0;
    let saveTimer = null;
    let pollTimer = null;
    let closed = false;

    function setStatus(text, cls = '') {
      statusEl.textContent = text;
      statusEl.className = 'meet-status ' + cls;
    }

    async function save() {
      if (saving || !dirty || closed) return;
      saving = true;
      setStatus('저장 중…', 'saving');
      const bodyText = srcEl.value;
      try {
        const res = await fetch(`/api/meetings?project=${project.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ id, body: bodyText, baseVersion: localVersion, updatedBy: TT.me() }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.meeting) {
          // 충돌: 다른 사람 저장이 앞섬. 로컬 커서 위치 보존한 채로 서버 본문 적용
          // (심각한 충돌은 아니지만 알림)
          const cursorAtEnd = srcEl.selectionStart === srcEl.value.length;
          const localBody = srcEl.value;
          const serverBody = data.meeting.body || '';
          if (localBody === serverBody) {
            localVersion = data.meeting.version;
          } else {
            // 로컬이 우세: 다시 저장 시도 (덮어쓰기)
            localVersion = data.meeting.version;
            saving = false;
            setStatus('덮어쓰는 중…', 'saving');
            dirty = true;
            scheduleSave(200);
            return;
          }
          if (cursorAtEnd) srcEl.setSelectionRange(srcEl.value.length, srcEl.value.length);
          prevEl.innerHTML = mdRender(srcEl.value);
        } else if (!res.ok) {
          throw new Error((data && data.error) || `저장 실패 (${res.status})`);
        } else {
          localVersion = data.meeting.version;
        }
        dirty = false;
        setStatus(`저장됨 · ${TT.esc(data.meeting.updatedBy || '')} ${fmtWhen(data.meeting.updatedAt)}`, 'ok');
      } catch (ex) {
        setStatus(ex.message, 'err');
      } finally {
        saving = false;
      }
    }

    function scheduleSave(delay = 700) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, delay);
    }

    srcEl.addEventListener('input', () => {
      lastKeystroke = Date.now();
      dirty = true;
      prevEl.innerHTML = mdRender(srcEl.value);
      setStatus('편집 중…', 'editing');
      scheduleSave();
    });

    // 폴링: 로컬이 clean이고 최근 타이핑 없으면 서버 버전 반영
    async function poll() {
      if (closed) return;
      if (dirty || (Date.now() - lastKeystroke < 1500) || document.hidden) return;
      try {
        const { meeting: latest } = await TT.api('GET', `/api/meetings?project=${project.id}&id=${encodeURIComponent(id)}`);
        if (latest.version > localVersion) {
          // 커서 위치 보존 시도
          const pos = srcEl.selectionStart;
          srcEl.value = latest.body || '';
          try { srcEl.setSelectionRange(Math.min(pos, srcEl.value.length), Math.min(pos, srcEl.value.length)); } catch { /* ignore */ }
          prevEl.innerHTML = mdRender(srcEl.value);
          localVersion = latest.version;
          setStatus(`${TT.esc(latest.updatedBy || '')}님이 방금 수정 · 반영됨`, 'ok');
        }
      } catch { /* 조용히 무시 */ }
    }
    pollTimer = setInterval(poll, 1800);

    // 페이지 이탈 시 저장 시도 + 정리
    destroyDetail = () => {
      closed = true;
      clearTimeout(saveTimer);
      clearInterval(pollTimer);
      if (dirty && !saving) {
        // 페이지 이탈 시에도 마지막 저장 시도 (keepalive)
        try {
          fetch(`/api/meetings?project=${project.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            keepalive: true,
            body: JSON.stringify({ id, body: srcEl.value, baseVersion: localVersion, updatedBy: TT.me() }),
          });
        } catch { /* ignore */ }
      }
    };

    window.addEventListener('beforeunload', destroyDetail, { once: true });
  }

  // ---------- 툴바 ----------
  main.querySelector('#newMeet').onclick = async () => {
    try {
      const { meeting } = await TT.api('POST', `/api/meetings?project=${project.id}`, {
        updatedBy: TT.me(),
      });
      meetings.unshift(meeting);
      renderList();
      openDetail(meeting.id);
    } catch (ex) { TT.toast(ex.message, true); }
  };

  await loadList();
  const listPoll = setInterval(() => {
    if (document.hidden || detailId) return;
    loadList();
  }, 20000);

  return () => {
    clearInterval(listPoll);
    if (destroyDetail) destroyDetail();
  };
};
