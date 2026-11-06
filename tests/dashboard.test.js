import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import * as Y from 'yjs';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'patz-tests-'));
process.env.TT_DATA_FILE=path.join(directory,'kv.json');
process.env.AUTH_SECRET='test-secret-for-isolated-tests-only';
const db=await import('../lib/dashboard.js');
const kv=await import('../lib/kv.js');
const legacy=await import('../lib/store.js');
const {syncNote}=await import('../lib/note-sync.js');
const {grantProject}=await import('../lib/auth.js');
const {default:dashboard}=await import('../api/dashboard.js');
const {default:notes}=await import('../api/notes.js');
const server=http.createServer((req,res)=>(req.url.startsWith('/api/notes')?notes:dashboard)(req,res));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
function cookie(project){let value;grantProject({headers:{}},{setHeader:(k,v)=>{value=v;}},project);return value.split(';')[0];}
const teamCookie=cookie('patz');
const request=(method,url,body,headers={})=>fetch(origin+url,{method,headers:{Cookie:teamCookie,Origin:origin,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});

test('shared budget counts quantity × unit price, edit and deletion recalculate',async()=>{
  const e=await db.createRecord('expenses',{title:'구독',quantity:3,unitPrice:12300,date:'2026-11-06'});
  assert.equal(e.amount,36900);
  assert.equal((await db.getDashboard()).budget.remaining,1963100);
  await db.updateRecord('expenses',e.id,{quantity:2,baseVersion:e.version});
  assert.equal((await db.getDashboard()).budget.remaining,1975400);
  await db.deleteRecord('expenses',e.id);
  assert.equal((await db.getDashboard()).budget.remaining,2000000);
  await assert.rejects(db.createRecord('expenses',{title:'bad',quantity:0,unitPrice:10,date:'2026-11-06'}),{status:400});
  await assert.rejects(db.createRecord('expenses',{title:'bad',quantity:1,unitPrice:1.2,date:'2026-11-06'}),{status:400});
  await assert.rejects(db.createRecord('schedules',{title:'bad',project:'patz',date:'2026-99-99'}),{status:400});
});
test('tasks retain nested todos, assignment, status, stable order and reject stale overwrites',async()=>{
  const a=await db.createRecord('tasks',{title:'A',project:'patz',due:'2026-11-10',assignee:'은우',subtasks:[{title:'세부',done:false}]});
  const b=await db.createRecord('tasks',{title:'B',project:'room42',assignee:'민우'});
  const c=await db.createRecord('tasks',{title:'C',project:'mandudang',assignee:'채은'});
  await db.reorderTask(c.id,a.id);
  assert.deepEqual((await db.getDashboard()).tasks.map(t=>t.id),[c.id,a.id,b.id]);
  const updated=await db.updateRecord('tasks',a.id,{status:'finished',baseVersion:a.version});
  assert.equal(updated.subtasks[0].title,'세부');assert.equal(updated.status,'finished');
  await assert.rejects(db.updateRecord('tasks',a.id,{title:'stale',baseVersion:a.version}),{status:409});
  const responses=await Promise.allSettled([db.updateRecord('tasks',b.id,{title:'B1',baseVersion:b.version}),db.updateRecord('tasks',b.id,{title:'B2',baseVersion:b.version})]);
  assert.equal(responses.filter(r=>r.status==='fulfilled').length,1);
  await db.deleteRecord('tasks',c.id);
  await assert.rejects(db.updateRecord('tasks',c.id,{title:'resurrect'}),{status:404});
});
test('vault encrypts credentials and card numbers, list only returns masked data',async()=>{
  const a=await db.createRecord('accounts',{title:'gmail',username:'team@example.test',password:'  secret-one  '});
  const c=await db.createRecord('accounts',{kind:'card',title:'팀 카드',number:'4111 1111 1111 1111',holder:'팀',expiry:'12/29'});
  const disk=await fs.readFile(process.env.TT_DATA_FILE,'utf8');
  assert.ok(!disk.includes('secret-one'));assert.ok(!disk.includes('4111111111111111'));
  assert.equal((await db.revealAccount(a.id)).password,'  secret-one  ');
  assert.equal(c.summary,'•••• 1111');
  const all=await db.getDashboard();assert.ok(!JSON.stringify(all).includes('secret-one'));assert.ok(!('secret' in all.accounts[0]));
  await db.updateRecord('accounts',a.id,{title:'Gmail'});
  assert.equal((await db.revealAccount(a.id)).password,'  secret-one  ');
});
test('legacy notes are copied once without changing the archived original',async()=>{
  const old=await legacy.createMeeting('patz',{title:'예전 회의록',date:'2026-11-01'});
  await legacy.saveMeetingBody('patz',old.id,{body:'# 결정\n\n원본 내용',baseVersion:1});
  await db.getDashboard();await db.getDashboard();
  const imported=await db.getRecord('notes',`legacy-${old.id}`);
  assert.equal(imported.title,'예전 회의록');
  await db.updateRecord('notes',imported.id,{title:'새 이름'});
  assert.equal((await legacy.getMeeting('patz',old.id)).title,'예전 회의록');
  const synced=await syncNote(imported.id);const document=new Y.Doc();Y.applyUpdate(document,Buffer.from(synced.update,'base64'));
  assert.match(document.getXmlFragment('default').toString(),/결정/);document.destroy();
});
test('concurrent note updates converge, retries are idempotent and compaction preserves edits',async()=>{
  const note=await db.createRecord('notes',{title:'동시 편집',date:'2026-11-06'});
  const initial=await syncNote(note.id);
  const a=new Y.Doc(),b=new Y.Doc();for(const d of [a,b])Y.applyUpdate(d,Buffer.from(initial.update,'base64'));
  const baseA=Y.encodeStateVector(a),baseB=Y.encodeStateVector(b);
  a.getXmlFragment('default').get(0).insert(0,[new Y.XmlText('은우 작성 ')]);
  b.getXmlFragment('default').get(0).insert(0,[new Y.XmlText('민우 작성 ')]);
  const ua=Buffer.from(Y.encodeStateAsUpdate(a,baseA)).toString('base64'),ub=Buffer.from(Y.encodeStateAsUpdate(b,baseB)).toString('base64');
  await Promise.all([syncNote(note.id,{update:ua,clientId:'test-a',name:'은우'}),syncNote(note.id,{update:ub,clientId:'test-b',name:'민우'})]);
  await syncNote(note.id,{update:ua});
  let response=await syncNote(note.id);
  for(const d of [a,b])Y.applyUpdate(d,Buffer.from(response.update,'base64'));
  assert.equal(a.getXmlFragment('default').toString(),b.getXmlFragment('default').toString());
  assert.match(a.getXmlFragment('default').toString(),/은우 작성/);assert.match(a.getXmlFragment('default').toString(),/민우 작성/);
  assert.equal(response.presence.length,2);
  for(let i=0;i<38;i++){
    const vector=Y.encodeStateVector(a);a.getXmlFragment('default').get(0).get(0).insert(0,`${i},`);
    await syncNote(note.id,{update:Buffer.from(Y.encodeStateAsUpdate(a,vector)).toString('base64')});
  }
  response=await syncNote(note.id);Y.applyUpdate(b,Buffer.from(response.update,'base64'));
  assert.equal(a.getXmlFragment('default').toString(),b.getXmlFragment('default').toString());
  await assert.rejects(syncNote(note.id,{update:'not valid!'}),{status:400});a.destroy();b.destroy();
});
test('API enforces login, workspace isolation, CSRF, validation and persistent CRUD',async()=>{
  assert.equal((await request('GET','/api/dashboard?project=patz',null,{Cookie:''})).status,401);
  assert.equal((await request('GET','/api/dashboard?project=jarvis',null,{Cookie:cookie('jarvis')})).status,403);
  assert.equal((await request('POST','/api/dashboard?project=patz',{type:'notes',title:'bad'},{Origin:'https://untrusted.test'})).status,403);
  const response=await request('POST','/api/dashboard?project=patz',{type:'schedules',title:'출시',project:'room42',date:'2026-12-01',important:true});
  assert.equal(response.status,201);const {item}=await response.json();
  const snapshot=await (await request('GET','/api/dashboard?project=patz')).json();assert.equal(snapshot.schedules.find(s=>s.id===item.id).important,true);
  assert.equal((await request('POST','/api/dashboard?project=patz',{type:'schedules',title:'bad',project:'missing',date:'2026-11-06'})).status,400);
  assert.equal((await request('POST','/api/notes?project=patz',{image:'data:image/svg+xml;base64,abc'})).status,400);
  const picture='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const upload=await request('POST','/api/notes?project=patz',{image:picture});assert.equal(upload.status,201);const {imageId}=await upload.json();
  const asset=await request('GET',`/api/notes?project=patz&imageId=${imageId}`);assert.equal(asset.headers.get('content-type'),'image/png');
  assert.equal((await request('GET',`/api/notes?project=patz&imageId=${imageId}`,null,{Cookie:''})).status,401);
});

test('large offline note batches fit the HTTP limit and survive a fresh read',async()=>{
  const note=await db.createRecord('notes',{title:'긴 회의록',date:'2026-11-06'});
  const initial=await syncNote(note.id),doc=new Y.Doc();
  Y.applyUpdate(doc,Buffer.from(initial.update,'base64'));
  const vector=Y.encodeStateVector(doc);
  doc.getXmlFragment('default').get(0).insert(0,[new Y.XmlText('a'.repeat(1100000))]);
  const update=Buffer.from(Y.encodeStateAsUpdate(doc,vector)).toString('base64');
  assert.ok(update.length>1200*1024);
  const saved=await request('POST','/api/notes?project=patz',{id:note.id,update});
  assert.equal(saved.status,200);
  const reload=await syncNote(note.id),other=new Y.Doc();Y.applyUpdate(other,Buffer.from(reload.update,'base64'));
  assert.equal(other.getXmlFragment('default').get(0).get(0).length,1100000);
  doc.destroy();other.destroy();
});
