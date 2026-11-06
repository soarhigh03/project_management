import { createFilterChip } from './filter-chip.js';

const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const esc = TT.esc;
const API = '/api/dashboard?project=patz';
const LABELS = { patz: 'PATZ', room42: 'room42', mandudang: 'mandudang', all: 'ALL' };
const HEADINGS = { tasks: 'RnR', schedules: 'UPCOMING SCHEDULE', expenses: 'BUDGET MANAGEMENT', accounts: 'ACCOUNT INFORMATION', notes: 'MEETING NOTES' };
const money = value => `${Number(value || 0).toLocaleString('ko-KR')}원`;
const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const dateObj = d => new Date(`${d}T12:00:00`);
const dayName = d => days[dateObj(d).getDay()] || '';
const shortDate = d => d ? d.slice(5).replace('-', '.') : '';
const noteDate = d => `${d.replaceAll('-', '').slice(2)} (${dayName(d)})`;
let data = { tasks: [], schedules: [], expenses: [], accounts: [], notes: [], budget: { remaining: 2000000 } };
let scope = new URLSearchParams(location.search).get('view') || 'patz';
if (!(scope in LABELS)) scope = 'patz';
let revision = '', refreshing = false, noteController = null, routeGeneration = 0, dragging = false;
const filters = Object.fromEntries(['projectFilter', 'assigneeFilter', 'statusFilter'].map(id => [id, createFilterChip(document.getElementById(id))]));
TT.me = () => localStorage.getItem('tt_me:patz') || 'undefined';

function showError(e) { TT.toast(e.message || '다시 시도해 주세요.', true); }
function setHTML(id, html) { const el = document.getElementById(id); if (el.innerHTML !== html) { const y = el.scrollTop; el.innerHTML = html; el.scrollTop = y; } }
function empty(label, type) { return `<p class="empty">${label}<br><button data-add="${type}">+ 추가하기</button></p>`; }
function filteredTasks() {
  const project = $('#projectFilter').value, assignee = $('#assigneeFilter').value, status = $('#statusFilter').value;
  return data.tasks.filter(t => (project === 'all' || t.project === project) && (assignee === 'all' || t.assignee === assignee) && (status === 'all' || t.status === status));
}
function scheduleLabel(item) {
  if (scope !== 'all') return esc(item.title);
  const [, start, ending] = item.title.match(/^([\s\S]*?)(\S{1,16})$/) || ['', '', item.title];
  return `${esc(start)}<span class="schedule-ending">${esc(ending)}<sup class="schedule-project">${LABELS[item.project]}</sup></span>`;
}
function renderSchedules() {
  const groups = new Map();
  const schedules = data.schedules.filter(s => scope === 'all' || s.project === scope);
  for (const item of schedules) { if (!groups.has(item.date)) groups.set(item.date, []); groups.get(item.date).push(item); }
  setHTML('schedules', [...groups].map(([date, items]) => `<div class="schedule-row row-rule"><div class="date-lockup" title="${esc(date)}"><span class="date-number">${date.slice(8)}</span><span class="date-day">${dayName(date)}</span></div><div class="schedule-items">${items.map(s => `<button class="schedule-item ${s.important ? 'important' : ''}" data-edit="schedules" data-id="${s.id}" aria-label="${esc(s.important ? '중요 일정: ' : '')}${esc(s.title)} 수정">${scheduleLabel(s)}<span class="edit-mark" aria-hidden="true">↗</span></button>`).join('')}</div></div>`).join('') || empty('등록된 일정이 없습니다.', 'schedules'));
}
function handleMarkup(taskId, subtaskId = '') { return `<button class="drag-handle" data-drag="${taskId}" ${subtaskId ? `data-subtask="${subtaskId}"` : ''} aria-label="순서 이동. Alt와 위 또는 아래 방향키로도 이동할 수 있습니다." title="드래그해서 순서 이동 · Alt + ↑/↓"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></button>`; }
function renderTasks() {
  const tasks = filteredTasks();
  setHTML('tasks', tasks.map(t => `<article class="task-group" data-task="${t.id}"><div class="task-row ${t.status === 'finished' ? 'is-finished' : ''}">
    <button class="task-due" data-task-edit="${t.id}" data-focus="due" title="더블클릭하여 마감일 수정">${t.due ? `~${t.due.slice(5).replace('-', '/')}` : '—'}</button>
    <button class="task-title ${t.status === 'finished' ? 'finished' : ''}" data-task-edit="${t.id}" data-focus="title" title="더블클릭하여 작업 수정">${esc(t.title)}</button>
    <button class="badge" data-task-edit="${t.id}" data-focus="project" title="더블클릭하여 프로젝트 수정">${LABELS[t.project]}</button>
    <button class="badge ${t.assignee === 'undefined' ? 'unassigned' : ''}" data-task-edit="${t.id}" data-focus="assignee" title="더블클릭하여 담당자 수정">${esc(t.assignee)}</button>
    <input type="checkbox" class="status-check" data-task-check="${t.id}" ${t.status === 'finished' ? 'checked' : ''} aria-label="${esc(t.title)} 완료">
    ${handleMarkup(t.id)}</div>${t.subtasks?.length ? `<div class="subtasks">${t.subtasks.map(s => `<div class="subtask-row ${s.done ? 'is-finished' : ''}" data-sub="${s.id}" data-parent="${t.id}"><button class="task-title ${s.done ? 'finished' : ''}" data-task-edit="${t.id}" data-focus="subtasks" title="더블클릭하여 세부 할 일 수정">${esc(s.title)}</button><input type="checkbox" class="status-check" data-sub-check="${s.id}" data-parent="${t.id}" ${s.done ? 'checked' : ''} aria-label="${esc(s.title)} 완료">${handleMarkup(t.id,s.id)}</div>`).join('')}</div>` : ''}</article>`).join('') || empty('필터에 맞는 작업이 없습니다.', 'tasks'));
}
function renderShared() {
  setHTML('expenses', data.expenses.map(e => `<button class="expense-row row-rule" data-edit="expenses" data-id="${e.id}" aria-label="${esc(e.title)} 지출 수정"><span>${esc(e.title)}</span><span class="expense-detail">${e.quantity || 1}건 / ${shortDate(e.date)} / ${money(e.amount)}</span></button>`).join('') || empty('아직 사용한 예산이 없습니다.', 'expenses'));
  $('#balance').textContent = money(data.budget.remaining);
  $('#balance').classList.toggle('negative', data.budget.remaining < 0);
  if (!$('#notes .rename-input')) setHTML('notes', data.notes.map(n => `<div class="note-row row-rule" data-note="${n.id}"><button class="note-date" data-note-open="${n.id}" aria-label="${esc(n.title)} 열기">${noteDate(n.date)}</button><button class="note-title" data-note-title="${n.id}" title="클릭해서 열기 · 더블클릭해서 제목 수정">${esc(n.title)}</button><button class="note-open" data-note-open="${n.id}" aria-label="${esc(n.title)} 열기"><img src="/assets/figma/arrow.svg" alt=""></button></div>`).join('') || empty('첫 회의록을 작성해 보세요.', 'notes'));
  setHTML('accounts', data.accounts.map(a => `<article class="account-row row-rule" data-account="${a.id}"><button class="account-name" data-edit="accounts" data-id="${a.id}" title="계정 정보 수정">${esc(a.title)}${a.kind === 'card' ? '<span class="account-kind">CARD</span>' : ''}</button><div class="account-details"><button class="account-id" data-edit="accounts" data-id="${a.id}" title="정보 수정">${esc(a.summary)}</button><div class="account-secret"><span class="masked">**************</span><button class="icon-button" data-reveal="${a.id}" aria-label="${esc(a.title)} ${a.kind === 'card' ? '카드 번호' : '비밀번호'} 표시"><img src="/assets/figma/eye.png" alt=""></button><button class="icon-button" data-copy="${a.id}" aria-label="${esc(a.title)} ${a.kind === 'card' ? '카드 번호' : '비밀번호'} 복사"><img src="/assets/figma/copy.png" alt=""></button></div></div></article>`).join('') || empty('팀에서 사용하는 계정이나 카드를 추가하세요.', 'accounts'));
}
function render() { renderSchedules(); renderTasks(); renderShared(); }
async function refresh(force = false) {
  if (refreshing || dragging) return;
  refreshing = true;
  try {
    const next = await TT.api('GET', API);
    const nextRevision = JSON.stringify(next);
    data = next;
    if (!dragging && (force || nextRevision !== revision)) { revision = nextRevision; render(); }
    $('#app').setAttribute('aria-busy', 'false');
  } catch (e) {
    if (!revision) { $('#tasks').innerHTML = `<div class="error-box">${esc(e.message)} <button id="retryLoad">다시 시도</button></div>`; $('#retryLoad').onclick = () => refresh(true); }
    if (e.status === 401) location.href = '/';
  } finally { refreshing = false; }
}
function chooseProject(project, push = true) {
  scope = project;
  $$('.project-nav button').forEach(b => { const active = b.dataset.project === project; b.classList.toggle('active', active); b.setAttribute('aria-pressed', active); });
  $('#projectFilter').value = project;
  filters.projectFilter.sync();
  if (push) history.replaceState({}, '', `/p/patz/dashboard?view=${project}`);
  renderSchedules(); renderTasks();
}
async function mutate(method, body) { const result = await TT.api(method, API, body); await refresh(true); return result; }
function options(values, selected) { return values.map(v => { const [value,label] = Array.isArray(v) ? v : [v,v]; return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`; }).join(''); }
function inputField(name, label, value = '', type = 'text', extra = '', full = false) { return `<label class="field ${full ? 'full' : ''}"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`; }
function selectField(name, label, values, value, full = false) { return `<label class="field ${full ? 'full' : ''}"><span>${label}</span><select name="${name}">${options(values,value)}</select></label>`; }
const projectOptions = [['patz','PATZ'],['room42','room42'],['mandudang','mandudang']];
const memberOptions = ['은우','민우','채은','undefined'];
const dialog = $('#editDialog');
dialog.addEventListener('close', () => { dialog.innerHTML = ''; });
dialog.addEventListener('click', e => { if (e.target === dialog) { const r=dialog.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) dialog.close(); } });
function subtaskField(t = {}) { return `<div class="subtask-field" data-sub-id="${t.id || crypto.randomUUID()}"><input type="checkbox" aria-label="세부 할 일 완료" ${t.done ? 'checked' : ''}><input type="text" value="${esc(t.title || '')}" maxlength="300" placeholder="세부 할 일" aria-label="세부 할 일 내용"><button type="button" data-remove-sub aria-label="세부 할 일 삭제">×</button></div>`; }
async function openForm(type, record = null, focus = 'title') {
  let item = { ...(record || {}) };
  if (type === 'accounts' && item.id) {
    try { const { secret } = await TT.api('POST', API, { action:'reveal', id:item.id }); item = { ...item, ...secret }; } catch(e) { showError(e); return; }
  }
  let fields = '';
  if (type === 'tasks') {
    fields = inputField('title','항목',item.title,'text','required maxlength="300"',true)
      + inputField('due','마감일',item.due,'date') + selectField('project','프로젝트',projectOptions,item.project || (scope === 'all' ? 'patz' : scope))
      + selectField('assignee','담당자',memberOptions,item.assignee || TT.me()) + selectField('status','상태',['not finished','finished'],item.status || 'not finished')
      + `<div class="field full"><span>세부 할 일</span><div class="subtask-fields">${(item.subtasks || []).map(subtaskField).join('')}</div><button type="button" class="subtask-add">+ 세부 할 일 추가</button></div>`;
  } else if (type === 'schedules') {
    fields = inputField('title','일정',item.title,'text','required maxlength="300"',true) + inputField('date','날짜',item.date || TT.todayStr(),'date','required')
      + selectField('project','프로젝트',projectOptions,item.project || (scope === 'all' ? 'patz' : scope))
      + `<label class="form-check"><input type="checkbox" name="important" ${item.important ? 'checked' : ''}>중요 일정 · 빨간색 표시</label>`;
  } else if (type === 'expenses') {
    fields = inputField('title','항목',item.title,'text','required maxlength="300"',true) + inputField('quantity','수량(건수)',item.quantity || 1,'number','required min="1" max="100000" step="1"')
      + inputField('date','결제일',item.date || TT.todayStr(),'date','required') + inputField('unitPrice','가격 · 단가(원)',item.unitPrice ?? '', 'number','required min="0" max="1000000000" step="1"',true)
      + '<p class="hint field full" id="expenseTotal"></p>';
  } else if (type === 'accounts') {
    fields = selectField('kind','유형',[['account','계정'],['card','카드']],item.kind || 'account',true) + inputField('title','서비스 / 카드 이름',item.title,'text','required maxlength="300"',true)
      + `<div class="field full" id="accountFields">${inputField('username','아이디',item.username,'text','autocomplete="off" maxlength="300"',true)}${inputField('password','비밀번호',item.password,'password','autocomplete="new-password" maxlength="1000"',true)}</div>`
      + `<div class="field full" id="cardFields">${inputField('number','카드 번호',item.number,'text','inputmode="numeric" autocomplete="off" maxlength="23"',true)}${inputField('holder','카드 명의자',item.holder,'text','autocomplete="off"')}${inputField('expiry','유효기간 (MM/YY)',item.expiry,'text','placeholder="MM/YY" maxlength="5"')}</div>`
      + inputField('memo','메모',item.memo,'text','maxlength="1000"',true);
  } else if (type === 'notes') {
    fields = inputField('title','회의록 제목',item.title || `${data.notes.length + 1}차 회의록`,'text','required maxlength="300"',true) + inputField('date','회의 날짜',item.date || TT.todayStr(),'date','required',true);
  }
  dialog.innerHTML = `<form id="entityForm"><div class="dialog-head"><h2>${HEADINGS[type]}</h2><button type="button" class="close-button" aria-label="닫기">×</button></div><div class="form-grid">${fields}</div><p class="form-error" role="alert"></p><div class="form-actions">${item.id ? '<button type="button" class="danger-button" id="deleteRecord">삭제</button>' : ''}<span class="spacer"></span><button type="button" class="outline-button cancel">취소</button><button class="solid-button" type="submit">${item.id ? '저장' : '추가'}</button></div></form>`;
  dialog.showModal();
  const form = $('#entityForm');
  $('.close-button',dialog).onclick = $('.cancel',dialog).onclick = () => dialog.close();
  if(type === 'tasks') {
    $('.subtask-add',dialog).onclick = () => { $('.subtask-fields',dialog).insertAdjacentHTML('beforeend',subtaskField()); $('.subtask-fields .subtask-field:last-child input[type=text]',dialog).focus(); };
    $('.subtask-fields',dialog).onclick = e => { if(e.target.closest('[data-remove-sub]')) e.target.closest('.subtask-field').remove(); };
  }
  if (type === 'accounts') {
    const toggle = () => { const card = form.elements.kind.value === 'card'; $('#accountFields').hidden = card; $('#cardFields').hidden = !card; for(const el of $$('#accountFields input')) el.disabled = card; for(const el of $$('#cardFields input')) el.disabled = !card; };
    form.elements.kind.onchange = toggle; toggle();
  }
  if (type === 'expenses') { const total = () => $('#expenseTotal').textContent = `총 지출 ${money(Number(form.elements.quantity.value) * Number(form.elements.unitPrice.value))} · 세 프로젝트 공용 예산`; form.oninput = total; total(); }
  const target = focus === 'subtasks' ? $('.subtask-field input[type=text]',form) || $('.subtask-add',form) : form.elements[focus];
  target?.focus();
  if (item.id) $('#deleteRecord').onclick = async () => {
    const button = $('#deleteRecord');
    if (!button.dataset.confirm) { button.dataset.confirm = 'yes'; button.textContent = '한 번 더 눌러 삭제'; return; }
    button.disabled = true;
    try { await TT.api('DELETE',`${API}&type=${type}&id=${encodeURIComponent(item.id)}`); dialog.close(); await refresh(true); } catch(e) { $('.form-error',dialog).textContent = e.message; button.disabled=false; }
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if(type === 'tasks') values.subtasks = $$('.subtask-field',form).map(row => ({ id:row.dataset.subId, title:$('input[type=text]',row).value, done:$('input[type=checkbox]',row).checked })).filter(t=>t.title.trim());
    if(type === 'schedules') values.important = form.elements.important.checked;
    const submit = $('button[type=submit]',form); submit.disabled = true;
    try {
      const result = await mutate(item.id ? 'PATCH' : 'POST', { ...values, type, ...(item.id ? { id:item.id,baseVersion:item.version } : {}) });
      dialog.close();
      if(type === 'notes' && !item.id) await openNote(result.item.id);
    } catch(e) { $('.form-error',form).textContent = e.message; submit.disabled=false; }
  };
}
async function patchTask(task, patch) { try { await mutate('PATCH',{ type:'tasks', id:task.id, baseVersion:task.version, ...patch }); } catch(e) { showError(e); await refresh(true); } }
let noteClickTimer;
async function renameNote(id, button) {
  clearTimeout(noteClickTimer);
  const note = data.notes.find(n=>n.id===id); if(!note) return;
  const input = document.createElement('input'); input.className='rename-input'; input.value=note.title; input.maxLength=300; input.setAttribute('aria-label','회의록 제목 수정');
  button.replaceWith(input); input.focus(); input.select();
  let done = false;
  async function commit(cancel = false) {
    if(done) return; done=true;
    try { if(!cancel && input.value.trim() && input.value.trim()!==note.title) await mutate('PATCH',{type:'notes',id,title:input.value,baseVersion:note.version}); } catch(e){showError(e);}
    input.remove(); renderShared();
  }
  input.onblur = () => commit();
  input.onkeydown = e => { if(e.key==='Enter'){e.preventDefault();commit();} if(e.key==='Escape')commit(true); };
}
const revealTimers = new Map();
async function secretAction(id, copy) {
  const account = data.accounts.find(a=>a.id===id); if(!account) return;
  const row = $(`[data-account="${id}"]`), masked=$('.masked',row);
  if(!copy && masked.dataset.revealed) { masked.textContent='**************';delete masked.dataset.revealed;clearTimeout(revealTimers.get(id));return; }
  try {
    const {secret} = await TT.api('POST',API,{action:'reveal',id});
    const value = account.kind==='card' ? secret.number : secret.password;
    if(copy) { await navigator.clipboard.writeText(value || ''); TT.toast('복사했습니다.'); }
    else { masked.textContent=value || '(비밀번호 없음)';masked.dataset.revealed='true';clearTimeout(revealTimers.get(id));revealTimers.set(id,setTimeout(()=>{masked.textContent='**************';delete masked.dataset.revealed;},15000)); }
  } catch(e){showError(e);}
}
function hideSecrets(){ $$('.masked[data-revealed]').forEach(el=>{el.textContent='**************';delete el.dataset.revealed;}); }
window.addEventListener('blur',hideSecrets);
document.addEventListener('visibilitychange',()=>{if(document.hidden)hideSecrets();else refresh();});

document.addEventListener('click', e => {
  const add=e.target.closest('[data-add]');if(add){openForm(add.dataset.add);return;}
  const edit=e.target.closest('[data-edit]');if(edit){openForm(edit.dataset.edit,data[edit.dataset.edit].find(x=>x.id===edit.dataset.id));return;}
  const nav=e.target.closest('[data-project]');if(nav){chooseProject(nav.dataset.project);return;}
  const open=e.target.closest('[data-note-open]');if(open){openNote(open.dataset.noteOpen);return;}
  const title=e.target.closest('[data-note-title]');if(title){clearTimeout(noteClickTimer); if(e.detail<2)noteClickTimer=setTimeout(()=>openNote(title.dataset.noteTitle),280);return;}
  const reveal=e.target.closest('[data-reveal]');if(reveal){secretAction(reveal.dataset.reveal,false);return;}
  const copy=e.target.closest('[data-copy]');if(copy)secretAction(copy.dataset.copy,true);
});
document.addEventListener('dblclick',e=>{
  const task=e.target.closest('[data-task-edit]');if(task)openForm('tasks',data.tasks.find(t=>t.id===task.dataset.taskEdit),task.dataset.focus);
  const title=e.target.closest('[data-note-title]');if(title)renameNote(title.dataset.noteTitle,title);
});
document.addEventListener('keydown',e=>{const task=e.target.closest('[data-task-edit]');if(task && (e.key==='Enter'||e.key==='F2')){e.preventDefault();openForm('tasks',data.tasks.find(t=>t.id===task.dataset.taskEdit),task.dataset.focus);}const title=e.target.closest('[data-note-title]');if(title&&e.key==='F2'){e.preventDefault();renameNote(title.dataset.noteTitle,title);}});
document.addEventListener('change',e=>{
  if(e.target.matches('[data-task-check]')){const checkbox=e.target;const task=data.tasks.find(t=>t.id===e.target.dataset.taskCheck);e.target.disabled=true;e.target.closest('.task-row').classList.toggle('is-finished',e.target.checked);patchTask(task,{status:e.target.checked?'finished':'not finished'}).finally(()=>{checkbox.disabled=false;});}
  if(e.target.matches('[data-sub-check]')){const checkbox=e.target;const task=data.tasks.find(t=>t.id===e.target.dataset.parent);e.target.disabled=true;e.target.closest('.subtask-row').classList.toggle('is-finished',e.target.checked);patchTask(task,{subtasks:task.subtasks.map(s=>s.id===e.target.dataset.subCheck?{...s,done:e.target.checked}:s)}).finally(()=>{checkbox.disabled=false;});}
});
for(const id of ['projectFilter','assigneeFilter','statusFilter']) document.getElementById(id).onchange=()=>{if(id==='projectFilter'&&scope!=='all'&&$('#projectFilter').value!==scope){const chosen=$('#projectFilter').value;chooseProject('all');$('#projectFilter').value=chosen;filters.projectFilter.sync();}renderTasks();};

async function moveTask(id, beforeId, subId) {
  if(subId){const task=data.tasks.find(t=>t.id===id);const subtasks=task.subtasks.filter(s=>s.id!==subId);const moving=task.subtasks.find(s=>s.id===subId);let index=beforeId?subtasks.findIndex(s=>s.id===beforeId):subtasks.length;if(index<0)index=subtasks.length;subtasks.splice(index,0,moving);await patchTask(task,{subtasks});}
  else try{await mutate('PATCH',{action:'reorder',id,beforeId});}catch(e){showError(e);}
}
$('#tasks').addEventListener('pointerdown',e=>{
  const handle=e.target.closest('[data-drag]');if(!handle || e.button!==0)return;e.preventDefault();
  const taskId=handle.dataset.drag,subId=handle.dataset.subtask;
  const source=handle.closest(subId?'.subtask-row':'.task-group');
  const startY=e.clientY;let target=null,moved=false,before=true;
  // Listen on window so cleanup survives pointer capture changes or refreshed rows.
  const move=ev=>{
    if(Math.abs(ev.clientY-startY)<5&&!moved)return;moved=true;dragging=true;source.classList.add('dragging');
    const hit=document.elementFromPoint(ev.clientX,ev.clientY)?.closest(subId?'.subtask-row':'.task-group');
    $$('.drop-target').forEach(x=>x.classList.remove('drop-target'));
    if(hit&&hit!==source&&(!subId||hit.dataset.parent===taskId)){target=hit;const rect=hit.getBoundingClientRect();before=ev.clientY<rect.top+rect.height/2;hit.classList.add('drop-target');}else target=null;
    const scroll=$('#tasks'),rect=scroll.getBoundingClientRect();if(ev.clientY<rect.top+35)scroll.scrollTop-=12;else if(ev.clientY>rect.bottom-35)scroll.scrollTop+=12;
  };
  const up=async()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);source.classList.remove('dragging');$$('.drop-target').forEach(x=>x.classList.remove('drop-target'));dragging=false;
    if(moved&&target){const rows=subId?data.tasks.find(t=>t.id===taskId).subtasks:filteredTasks();const targetId=subId?target.dataset.sub:target.dataset.task;const index=rows.findIndex(t=>t.id===targetId);const beforeId=before?targetId:rows[index+1]?.id||null;if(beforeId!== (subId||taskId))await moveTask(taskId,beforeId,subId);}
  };
  const cancel=()=>{target=null;up();};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);
});
$('#tasks').addEventListener('keydown',e=>{
  const handle=e.target.closest('[data-drag]');if(!handle||!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();
  const id=handle.dataset.drag,sub=handle.dataset.subtask,rows=sub?data.tasks.find(t=>t.id===id).subtasks:filteredTasks();const index=rows.findIndex(t=>t.id===(sub||id));
  if(e.key==='ArrowUp'&&index>0)moveTask(id,rows[index-1].id,sub);if(e.key==='ArrowDown'&&index<rows.length-1)moveTask(id,rows[index+2]?.id||null,sub);
});

async function openNote(id, push = true) {
  const generation=++routeGeneration;
  try {
    if(noteController){await noteController.destroy();noteController=null;}
    const { mountNoteEditor } = await import('/js/note-editor.bundle.js');
    if(generation!==routeGeneration)return;
    $('#dashboard').hidden=true;$('#notePage').hidden=false;$('#app').classList.add('editing-note');
    noteController=await mountNoteEditor($('#notePage'),id,{name:TT.me,onBack:closeNote,onRename:()=>refresh()});
    if(push)history.pushState({},'',`/p/patz/notes/${id}?view=${scope}`);
  }catch(e){showError(e);$('#dashboard').hidden=false;$('#notePage').hidden=true;$('#app').classList.remove('editing-note');}
}
async function closeNote(push = true) {
  try{if(noteController){await noteController.destroy();noteController=null;}}catch(e){showError(e);return;}
  ++routeGeneration;$('#dashboard').hidden=false;$('#notePage').hidden=true;$('#app').classList.remove('editing-note');
  if(push)history.pushState({},'',`/p/patz/dashboard?view=${scope}`);
  await refresh(true);
}
window.addEventListener('popstate',async()=>{const match=location.pathname.match(/\/notes\/([^/]+)$/);if(match)await openNote(match[1],false);else{await closeNote(false);chooseProject(new URLSearchParams(location.search).get('view')||'patz',false);}});

async function boot(){
  const project=location.pathname.match(/^\/p\/([^/]+)/)?.[1];
  if(project!=='patz'){location.replace(`/legacy${location.pathname}${location.search}`);return;}
  try{await TT.api('GET','/api/auth?project=patz');}catch{location.replace('/');return;}
  chooseProject(scope,false);await refresh(true);
  const match=location.pathname.match(/\/notes\/([^/]+)$/);if(match)await openNote(match[1],false);
  setInterval(()=>{if(!document.hidden&&!dialog.open&&!$('#notes .rename-input'))refresh();},3000);
}
boot();
