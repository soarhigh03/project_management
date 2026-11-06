import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import * as Y from 'yjs';

const URL = '/api/notes?project=patz';
const base64 = bytes => { let s='';for(const byte of bytes)s+=String.fromCharCode(byte);return btoa(s); };
const unbase64 = str => Uint8Array.from(atob(str),c=>c.charCodeAt(0));
const cacheDB = () => new Promise((resolve,reject)=>{const r=indexedDB.open('patz-note-drafts',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function cached(id,value){let db;try{db=await cacheDB();return await new Promise((resolve,reject)=>{const tx=db.transaction('drafts',value===undefined?'readonly':'readwrite');const store=tx.objectStore('drafts');const req=value===undefined?store.get(id):store.put(value,id);tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);});}finally{db?.close();}}

export async function mountNoteEditor(root,id,options={}){
  const $=q=>root.querySelector(q),esc=TT.esc;
  root.innerHTML='<div class="note-topbar">회의록 불러오는 중…</div>';
  const initial=await TT.api('GET',`${URL}&id=${encodeURIComponent(id)}`);
  const doc=new Y.Doc();Y.applyUpdate(doc,unbase64(initial.update),'remote');
  let queue=[],closed=false,syncing=null,timer=null,saveTimer=null,cacheTimer=null,titleDirty=false,titleSaving=null,uploading=0;
  let note=initial.note;
  let draft;
  try{draft=await cached(id);}catch{/* IndexedDB may be disabled by browser policy. */}
  if(draft){const serverVector=Y.encodeStateVector(doc);Y.applyUpdate(doc,draft,'remote');queue.push(Y.encodeStateAsUpdate(doc,serverVector));}
  const clientId=crypto.randomUUID();
  const buttons=[['bold','B','굵게 · ⌘/Ctrl+B'],['italic','I','기울임 · ⌘/Ctrl+I'],['strike','S','취소선'],['h1','H1','제목 1 · #'],['h2','H2','제목 2 · ##'],['bullet','•','글머리 목록 · -'],['ordered','1.','번호 목록 · 1.'],['task','☑','체크리스트 · []'],['quote','❞','인용 · >'],['code','</>','코드 블록 · ```'],['link','↗','링크 · ⌘/Ctrl+K'],['image','이미지','이미지 추가'],['undo','↶','실행 취소'],['redo','↷','다시 실행']];
  root.innerHTML=`<header class="note-topbar"><button data-back>← DASHBOARD</button><span class="presence" aria-live="polite"></span><span class="note-sync" role="status">연결 중…</span><button data-note-settings aria-label="회의록 설정">•••</button></header><div class="note-document-scroll"><article class="note-document"><input class="note-document-title" value="${esc(note.title)}" maxlength="300" aria-label="회의록 제목"><div class="note-meta"><span>${esc(note.date)}</span><span>공유 회의록 · 모두 편집 가능</span></div><div class="note-toolbar" role="toolbar" aria-label="회의록 편집 도구">${buttons.map(([cmd,label,title])=>`<button type="button" data-command="${cmd}" title="${esc(title)}" aria-label="${esc(title)}">${label}</button>`).join('')}</div><div class="editor-content"></div><p class="note-help"># 제목 · - 목록 · [] 체크리스트 · &gt; 인용 · 이미지 붙여넣기 또는 드래그</p><input type="file" class="note-upload" accept="image/*" multiple aria-label="이미지 파일"></article></div>`;
  function status(text,error=false){$('.note-sync').textContent=text;$('.note-sync').classList.toggle('error',error);}
  function persist(){clearTimeout(cacheTimer);cacheTimer=setTimeout(()=>cached(id,Y.encodeStateAsUpdate(doc)).catch(()=>status('임시 저장 불가 · 서버 저장을 확인하세요',true)),100);}
  function changed(update,origin){if(origin==='remote')return;queue.push(update);persist();status('저장 중…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>sync().catch(()=>{}),250);}
  doc.on('update',changed);
  const SafeImage=Image.extend({
    addAttributes(){return {...this.parent?.(),src:{default:null,parseHTML:element=>{const src=element.getAttribute('src')||'';return /^(?:https?:\/\/|\/api\/(?:notes|meetings)\?)/i.test(src)?src:null;}}};}
  });
  let editor;
  editor=new Editor({
    element:$('.editor-content'),
    extensions:[StarterKit.configure({undoRedo:false,link:{openOnClick:false,autolink:true,defaultProtocol:'https'}}),SafeImage,TaskList,TaskItem.configure({nested:true}),Placeholder.configure({placeholder:'회의 내용을 작성하세요. # 제목, - 목록, 이미지 붙여넣기를 사용할 수 있어요.'}),Collaboration.configure({document:doc})],
    editorProps:{attributes:{'aria-label':'회의록 본문','role':'textbox','aria-multiline':'true'},
      handlePaste(view,event){
        const files=[...(event.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));
        if(files.length){event.preventDefault();uploadImages(files);return true;}
        const html=event.clipboardData?.getData('text/html')||'';
        if(html){const fragment=new DOMParser().parseFromString(html,'text/html');const imgs=[...fragment.querySelectorAll('img')];const embedded=imgs.filter(img=>/^data:image\/(png|jpeg|webp|gif);base64,/i.test(img.src));if(embedded.length){event.preventDefault();Promise.all(embedded.map(img=>fetch(img.src).then(r=>r.blob()))).then(uploadImages);return true;}}
        return false;
      },
      handleDrop(view,event){const files=[...(event.dataTransfer?.files||[])].filter(f=>f.type.startsWith('image/'));if(files.length){event.preventDefault();const pos=view.posAtCoords({left:event.clientX,top:event.clientY});if(pos)editor.commands.setTextSelection(pos.pos);uploadImages(files);return true;}return false;},
      handleKeyDown(view,event){if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();editLink();return true;}return false;}
    },
    onSelectionUpdate:updateToolbar,onTransaction:updateToolbar,
  });
  function updateToolbar(){if(!editor)return;const active={bold:'bold',italic:'italic',strike:'strike',bullet:'bulletList',ordered:'orderedList',task:'taskList',quote:'blockquote',code:'codeBlock',link:'link'};for(const b of root.querySelectorAll('[data-command]')){const cmd=b.dataset.command;const on=cmd==='h1'?editor.isActive('heading',{level:1}):cmd==='h2'?editor.isActive('heading',{level:2}):active[cmd]?editor.isActive(active[cmd]):false;b.classList.toggle('is-active',on);b.setAttribute('aria-pressed',on);}}
  async function sync(){
    if(closed)return;if(syncing)return syncing;
    const sent=queue;queue=[];
    const payload={id,clientId,name:options.name?.()||'팀원',vector:base64(Y.encodeStateVector(doc)),...(sent.length?{update:base64(Y.mergeUpdates(sent))}:{})};
    syncing=(async()=>{
      try{
        const result=await TT.api('POST',URL,payload);
        if(closed)return;
        Y.applyUpdate(doc,unbase64(result.update),'remote');persist();
        const people=result.presence.filter(p=>p.clientId!==clientId);
        $('.presence').textContent=people.length?`${people.map(p=>p.name).join(', ')} · 함께 편집 중`:'나만 접속 중';
        if(!queue.length&&!titleDirty&&!uploading)status('모든 변경사항 저장됨');
        return true;
      }catch(e){queue=[...sent,...queue];status(e.status===401?'로그인이 만료되었습니다 · 작성 내용은 이 기기에 보관됨':'연결 재시도 중 · 이 기기에 임시 저장됨',true);throw e;}
      finally{syncing=null;}
    })();return syncing;
  }
  async function saveTitle(){
    if(titleSaving)return titleSaving;
    if(!titleDirty)return;
    const title=$('.note-document-title').value.trim();if(!title){$('.note-document-title').value=note.title;titleDirty=false;return;}
    titleSaving=(async()=>{const {item}=await TT.api('PATCH','/api/dashboard?project=patz',{type:'notes',id,title,baseVersion:note.version});note=item;titleDirty=$('.note-document-title').value.trim()!==title;options.onRename?.();})().finally(()=>{titleSaving=null;});return titleSaving;
  }
  $('.note-document-title').oninput=()=>{titleDirty=true;};
  $('.note-document-title').onblur=()=>saveTitle().catch(e=>{status(e.message,true);TT.toast(e.message,true);});
  $('[data-back]').onclick=()=>options.onBack?.();
  $('[data-note-settings]').onclick=()=>{
    const dialog=document.createElement('dialog');dialog.className='edit-dialog';
    dialog.innerHTML=`<form method="dialog"><div class="dialog-head"><h2>MEETING NOTE</h2><button aria-label="닫기">×</button></div><label class="field"><span>회의 날짜</span><input name="date" type="date" value="${esc(note.date)}" required></label><p class="form-error" role="alert"></p><div class="form-actions"><button type="button" class="danger-button" data-delete>회의록 삭제</button><span class="spacer"></span><button class="solid-button" data-save>저장</button></div></form>`;
    document.body.appendChild(dialog);dialog.showModal();dialog.addEventListener('close',()=>dialog.remove());
    dialog.querySelector('[data-save]').onclick=async e=>{e.preventDefault();try{await saveTitle();const {item}=await TT.api('PATCH','/api/dashboard?project=patz',{type:'notes',id,date:dialog.querySelector('input').value,baseVersion:note.version});note=item;$('.note-meta span').textContent=note.date;dialog.close();}catch(err){dialog.querySelector('.form-error').textContent=err.message;}};
    dialog.querySelector('[data-delete]').onclick=async e=>{const b=e.currentTarget;if(!b.dataset.confirm){b.dataset.confirm='yes';b.textContent='한 번 더 눌러 삭제';return;}try{await flush();await TT.api('DELETE',`/api/dashboard?project=patz&type=notes&id=${encodeURIComponent(id)}`);queue=[];titleDirty=false;dialog.close();options.onBack?.();}catch(err){dialog.querySelector('.form-error').textContent=err.message;}};
  };
  function editLink(){
    const dialog=document.createElement('dialog');dialog.className='edit-dialog';
    dialog.innerHTML=`<form><div class="dialog-head"><h2>LINK</h2><button type="button" aria-label="닫기">×</button></div><label class="field"><span>URL</span><input name="href" type="url" value="${esc(editor.getAttributes('link').href||'')}" placeholder="https://" autofocus></label><div class="form-actions"><button type="button" data-unlink>링크 제거</button><span class="spacer"></span><button class="solid-button">적용</button></div></form>`;
    document.body.appendChild(dialog);dialog.showModal();dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('.dialog-head button').onclick=()=>dialog.close();dialog.querySelector('[data-unlink]').onclick=()=>{editor.chain().focus().extendMarkRange('link').unsetLink().run();dialog.close();};dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const href=dialog.querySelector('input').value;if(!/^https?:\/\//i.test(href))return;if(editor.state.selection.empty)editor.chain().focus().insertContent({type:'text',text:href,marks:[{type:'link',attrs:{href}}]}).run();else editor.chain().focus().extendMarkRange('link').setLink({href}).run();dialog.close();};
  }
  root.querySelectorAll('[data-command]').forEach(button=>{
    button.onmousedown=e=>e.preventDefault();button.onclick=()=>{
      const chain=editor.chain().focus();const commands={bold:()=>chain.toggleBold().run(),italic:()=>chain.toggleItalic().run(),strike:()=>chain.toggleStrike().run(),h1:()=>chain.toggleHeading({level:1}).run(),h2:()=>chain.toggleHeading({level:2}).run(),bullet:()=>chain.toggleBulletList().run(),ordered:()=>chain.toggleOrderedList().run(),task:()=>chain.toggleTaskList().run(),quote:()=>chain.toggleBlockquote().run(),code:()=>chain.toggleCodeBlock().run(),link:editLink,image:()=>$('.note-upload').click(),undo:()=>chain.undo().run(),redo:()=>chain.redo().run()};commands[button.dataset.command]?.();
    };
  });
  async function uploadImages(files){
    uploading++;
    try{for(const file of files){status('이미지 업로드 중…');const image=await TT.compressImage(file,{preferPng:true});const {imageId}=await TT.api('POST',URL,{image});if(closed)return;editor.chain().focus().setImage({src:`${URL}&imageId=${encodeURIComponent(imageId)}`,alt:file.name||'붙여넣은 이미지'}).run();}await sync();}
    catch(e){status(e.message,true);TT.toast(e.message,true);}finally{uploading--;}
  }
  $('.note-upload').onchange=e=>{uploadImages([...e.target.files]);e.target.value='';};
  async function flush(){
    if(uploading)throw new Error('이미지 업로드가 끝난 뒤 이동해 주세요.');
    await saveTitle();if(syncing)await syncing;while(queue.length)await sync();await cached(id,Y.encodeStateAsUpdate(doc)).catch(()=>{});
  }
  const unload=e=>{if(queue.length||syncing||titleDirty||uploading){persist();e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',unload);
  const visibility=()=>{if(!document.hidden)sync().catch(()=>{});};document.addEventListener('visibilitychange',visibility);
  timer=setInterval(()=>{if(!document.hidden)sync().catch(()=>{});},1000);
  sync().catch(()=>{});
  return {async destroy(){await flush();closed=true;clearInterval(timer);clearTimeout(saveTimer);clearTimeout(cacheTimer);window.removeEventListener('beforeunload',unload);document.removeEventListener('visibilitychange',visibility);doc.off('update',changed);editor.destroy();doc.destroy();root.innerHTML='';}};
}
