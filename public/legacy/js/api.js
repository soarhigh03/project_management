// 서버 API 헬퍼 (전역 TT.api)
window.TT = window.TT || {};

TT.api = async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `요청 실패 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
};

TT.esc = function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
};

TT.toast = (() => {
  let timer = null;
  return function toast(msg, isErr = false) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(timer);
    timer = setTimeout(() => { el.className = ''; }, 2600);
  };
})();

// ---------- 이미지 유틸 (버그 스크린샷 / 회의록 본문 이미지 공용) ----------
// 긴 변을 줄이고 용량 한도(base64 길이)에 맞을 때까지 품질·해상도를 낮춘다.
//  · preferPng: 글자 많은 스크린샷은 PNG가 더 선명해서 한도 안에 들면 PNG를 쓴다.
TT.compressImage = async function compressImage(file, opts = {}) {
  const { maxSide = 1600, quality = 0.82, preferPng = false, maxBytes = 700 * 1024 } = opts;

  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('파일을 읽을 수 없습니다.'));
    r.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('이미지를 열 수 없습니다.'));
    i.src = dataUrl;
  });

  let best = null;
  for (const shrink of [1, 0.7, 0.5]) {
    const scale = Math.min(1, (maxSide * shrink) / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

    if (preferPng) {
      const png = canvas.toDataURL('image/png');
      if (png.length <= maxBytes) return png;
    }
    let q = quality;
    let out = canvas.toDataURL('image/jpeg', q);
    while (out.length > maxBytes && q > 0.4) {
      q -= 0.1;
      out = canvas.toDataURL('image/jpeg', q);
    }
    if (out.length <= maxBytes) return out;
    best = out;
  }
  return best; // 최대한 줄였지만 한도 초과 — 서버가 크기 검사로 거절한다
};

// 이미지 원본 보기 (클릭 시 전체 화면)
TT.lightbox = function lightbox(src) {
  const bg = document.createElement('div');
  bg.className = 'lightbox';
  bg.innerHTML = `<img src="${TT.esc(src)}" alt="이미지"><button class="lightbox-close" title="닫기">✕</button>`;
  bg.onclick = () => bg.remove();
  document.body.appendChild(bg);
};

// 날짜 포맷: 2026-07-09 → "7/9(목)"
TT.fmtDate = function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
};

TT.todayStr = function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
