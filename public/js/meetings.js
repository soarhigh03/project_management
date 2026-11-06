// 회의록 페이지 — 노션 DB 스타일 테이블 + 마크다운 에디터
//   · 테이블: 회차/제목/날짜/수정 시각. 제목·날짜는 인라인 편집 가능.
//   · 상세: 좌측 마크다운 소스, 우측 실시간 렌더. 자동 저장 + 폴링으로 동시편집.
//   · 낙관적 잠금: baseVersion을 서버가 확인, 충돌 시 안내.
window.TT = window.TT || {};
TT.pages = TT.pages || {};

// ---------- 미니 마크다운 렌더러 (의존성 0) ----------
// 지원: # 헤더, **굵게**, *기울임*, `코드`, ```블록```, - / 1. 리스트, > 인용,
//       [텍스트](링크), ![](이미지), 맨 URL 자동 링크, --- 구분선.
// 줄바꿈 규칙: 엔터 한 번 = 미리보기도 줄바꿈(<br>), 빈 줄 = 빈 줄 하나.
//   → 왼쪽 소스와 오른쪽 미리보기의 줄 수가 그대로 맞는다.
const MD_SAFE_HREF = /^(?:https?:\/\/|mailto:|\/|#)/i;
const MD_SAFE_IMG = /^(?:https?:\/\/|data:image\/|\/)/i;

function mdEsc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 굵게/기울임 — 이미 이스케이프된 문자열에 적용
function mdEmphasis(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
}

// 한 줄 안의 인라인 문법 처리.
// 완성된 태그는 \x01n\x01 슬롯으로 빼 두고 마지막에 되돌린다 —
// 그래야 URL 안의 *, & 같은 문자가 다른 규칙에 망가지지 않는다.
function mdInline(text) {
  const slots = [];
  const slot = (html) => `\x01${slots.push(html) - 1}\x01`;
  let s = text;

  // `코드` — 내부에는 다른 규칙을 적용하지 않는다
  s = s.replace(/`([^`]+)`/g, (_, code) => slot(`<code>${mdEsc(code)}</code>`));

  // ![alt](src) — 링크보다 먼저 (링크 문법을 포함하므로)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt, url) => (
    MD_SAFE_IMG.test(url)
      ? slot(`<img class="md-img" src="${mdEsc(url)}" alt="${mdEsc(alt)}" loading="lazy">`)
      : whole
  ));

  // [텍스트](링크)
  s = s.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (whole, txt, url) => {
    if (!MD_SAFE_HREF.test(url)) return whole;
    const label = mdEmphasis(mdEsc(txt)) || mdEsc(url);
    return slot(`<a href="${mdEsc(url)}" target="_blank" rel="noopener">${label}</a>`);
  });

  // 맨 URL 자동 링크 (문장 끝 구두점은 링크에서 제외)
  s = s.replace(/https?:\/\/[^\s<>"'`)\]}]+/g, (url) => {
    const tail = (url.match(/[.,;:!?]+$/) || [''])[0];
    const link = url.slice(0, url.length - tail.length);
    if (!link) return url;
    return slot(`<a href="${mdEsc(link)}" target="_blank" rel="noopener">${mdEsc(link)}</a>`) + tail;
  });

  return mdEmphasis(mdEsc(s)).replace(/\x01(\d+)\x01/g, (_, i) => slots[+i]);
}

function mdRender(src) {
  // 제어문자 제거 — 아래에서 쓰는 placeholder 위조를 막는다
  src = String(src ?? '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

  // 코드 블록 먼저 분리해서 placeholder로 치환
  const codes = [];
  src = src.replace(/```([\s\S]*?)```/g, (_, code) => {
    codes.push(`<pre><code>${mdEsc(code.replace(/^\n/, ''))}</code></pre>`);
    return `\x00CODE${codes.length - 1}\x00`;
  });

  const lines = src.split('\n');
  const out = [];
  let listType = null;  // 'ul' | 'ol' | null
  let quoteOpen = false;
  let para = [];        // 연속된 본문 줄 — <br>로 이어 한 단락으로 묶는다

  const flushPara = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const closeQuote = () => { if (quoteOpen) { flushPara(); out.push('</blockquote>'); quoteOpen = false; } };
  const closeAll = () => { flushPara(); closeList(); closeQuote(); };

  for (const line of lines) {
    if (/^\x00CODE\d+\x00$/.test(line.trim())) {
      closeAll();
      out.push(line.trim());
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      closeAll();
      out.push('<hr>');
      continue;
    }
    if (/^\s*$/.test(line)) {
      // 빈 줄 = 미리보기에도 빈 줄 하나 (소스와 줄 수를 맞춘다)
      closeAll();
      out.push('<div class="md-gap"></div>');
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeAll();
      out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`);
      continue;
    }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ol || ul) {
      flushPara(); closeQuote();
      const kind = ol ? 'ol' : 'ul';
      if (listType && listType !== kind) closeList();
      if (!listType) { out.push(`<${kind}>`); listType = kind; }
      out.push(`<li>${mdInline((ol || ul)[1])}</li>`);
      continue;
    }
    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      // 인용 안에서도 엔터 한 번은 줄바꿈 — 인용을 새로 열 때만 앞 단락을 닫는다
      if (!quoteOpen) { flushPara(); closeList(); out.push('<blockquote>'); quoteOpen = true; }
      para.push(mdInline(q[1]));
      continue;
    }
    closeList(); closeQuote();
    para.push(mdInline(line));
  }
  closeAll();

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
          <textarea id="mdSrc" class="md-src" placeholder="# 회의 안건&#10;&#10;- 논의 사항&#10;- 결정 사항&#10;&#10;이미지: 붙여넣기(⌘/Ctrl+V) 또는 드래그&#10;링크: 텍스트 선택 후 URL 붙여넣기 · ⌘/Ctrl+K"></textarea>
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

    // ---------- 커서 위치에 삽입 (실행 취소 기록 유지) ----------
    function insert(text) {
      srcEl.focus();
      let ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
      if (ok) return; // execCommand가 input 이벤트까지 알아서 발생시킨다
      const s = srcEl.selectionStart;
      const e = srcEl.selectionEnd;
      srcEl.value = srcEl.value.slice(0, s) + text + srcEl.value.slice(e);
      const pos = s + text.length;
      srcEl.setSelectionRange(pos, pos);
      srcEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 이미지처럼 한 줄을 차지하는 요소는 항상 새 줄에서 시작하게 한다
    function insertBlock(text) {
      const before = srcEl.value.slice(0, srcEl.selectionStart);
      insert(`${before && !before.endsWith('\n') ? '\n' : ''}${text}\n`);
    }

    // ---------- 이미지 붙여넣기 / 드래그·드롭 ----------
    const imgSrc = (imageId) => `/api/meetings?project=${encodeURIComponent(project.id)}&imageId=${encodeURIComponent(imageId)}`;

    async function uploadImages(files) {
      const imgs = [...files].filter((f) => f && f.type && f.type.startsWith('image/'));
      if (!imgs.length) return;
      for (let i = 0; i < imgs.length; i++) {
        setStatus(imgs.length > 1 ? `이미지 업로드 중… (${i + 1}/${imgs.length})` : '이미지 업로드 중…', 'saving');
        try {
          const dataUrl = await TT.compressImage(imgs[i], { preferPng: true });
          const { imageId } = await TT.api('POST', `/api/meetings?project=${project.id}`, { image: dataUrl });
          insertBlock(`![](${imgSrc(imageId)})`);
          setStatus('이미지 삽입됨', 'ok');
        } catch (ex) {
          setStatus(ex.message || '이미지 업로드 실패', 'err');
          TT.toast(ex.message || '이미지 업로드 실패', true);
          return;
        }
      }
    }

    // 클립보드에서 이미지 파일 뽑기 (items/files 양쪽 지원)
    function clipboardImages(cd) {
      const fromFiles = [...(cd.files || [])].filter((f) => f.type && f.type.startsWith('image/'));
      if (fromFiles.length) return fromFiles;
      return [...(cd.items || [])]
        .filter((it) => it.kind === 'file' && it.type && it.type.startsWith('image/'))
        .map((it) => it.getAsFile())
        .filter(Boolean);
    }

    srcEl.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      if (!cd) return;

      // 1) 클립보드에 이미지 비트맵/파일이 있으면 업로드해서 삽입
      const imgs = clipboardImages(cd);
      if (imgs.length) { e.preventDefault(); uploadImages(imgs); return; }

      const text = (cd.getData('text/plain') || '').trim();

      // 2) 웹페이지에서 복사한 이미지 — 비트맵 없이 HTML만 오는 경우 원본 주소로 임베드
      if (!text) {
        const html = cd.getData('text/html') || '';
        const m = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
        if (m && /^https?:\/\//i.test(m[1])) {
          e.preventDefault();
          insertBlock(`![](${m[1]})`);
          setStatus('이미지 주소로 삽입됨 (원본 사이트에 연결)', 'ok');
        }
        return;
      }

      // 3) 텍스트를 선택한 상태에서 URL 붙여넣기 → [선택한 텍스트](URL)
      const sel = srcEl.value.slice(srcEl.selectionStart, srcEl.selectionEnd);
      if (sel && !sel.includes('\n') && /^https?:\/\/\S+$/i.test(text)) {
        e.preventDefault();
        insert(`[${sel}](${text})`);
        setStatus('링크 연결됨', 'ok');
      }
    });

    ['dragenter', 'dragover'].forEach((ev) => srcEl.addEventListener(ev, (e) => {
      if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); srcEl.classList.add('drag'); }
    }));
    ['dragleave', 'dragend', 'drop'].forEach((ev) => srcEl.addEventListener(ev, () => srcEl.classList.remove('drag')));
    srcEl.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type && f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); uploadImages(files); }
    });

    // ---------- 링크 삽입 (⌘/Ctrl+K) ----------
    srcEl.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      const sel = srcEl.value.slice(srcEl.selectionStart, srcEl.selectionEnd);
      if (/^https?:\/\/\S+$/i.test(sel)) {
        insert(`[](${sel})`);                                  // URL을 골랐으면 대괄호 안에 커서
        const pos = srcEl.selectionStart - (sel.length + 3);
        srcEl.setSelectionRange(pos, pos);
      } else {
        insert(`[${sel}]()`);                                  // 그 외에는 괄호 안에 커서
        const pos = srcEl.selectionStart - 1;
        srcEl.setSelectionRange(pos, pos);
      }
    });

    // 미리보기 이미지 클릭 → 원본 크기로 보기
    prevEl.addEventListener('click', (e) => {
      const img = e.target.closest?.('img.md-img');
      if (img) TT.lightbox(img.src);
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
