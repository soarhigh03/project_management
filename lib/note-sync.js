import crypto from 'node:crypto';
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap';
import * as kv from './kv.js';
import { getRecord, fail, MEMBERS } from './dashboard.js';

const key = id => `tt:patz:note:${id}`;
const encode = bytes => Buffer.from(bytes).toString('base64');
function decode(value, max = 3 * 1024 * 1024) {
  if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('잘못된 문서 데이터입니다.');
  return new Uint8Array(Buffer.from(value, 'base64'));
}
function legacyDocument(markdown) {
  // Preserve existing Markdown verbatim while upgrading headings and images.
  const content = String(markdown).split('\n').map(line => {
    const heading = line.match(/^(#{1,6}) (.*)$/);
    const image = line.match(/^!\[([^\]]*)\]\((\/api\/meetings\?[^)]+)\)$/);
    if (image) return { type: 'image', attrs: { src: image[2], alt: image[1] } };
    const text = heading ? heading[2] : line;
    return { type: heading ? 'heading' : 'paragraph', ...(heading ? { attrs: { level: heading[1].length } } : {}), ...(text ? { content: [{ type: 'text', text }] } : {}) };
  });
  return { type: 'doc', content };
}
async function load(id) {
  const note = await getRecord('notes', id, true);
  if (!note) fail('회의록을 찾을 수 없습니다.', 404);
  let updates = await kv.hgetall(key(id));
  if (!updates.snapshot) {
    const schema = getSchema([StarterKit, Image]);
    const initial = prosemirrorJSONToYDoc(schema, legacyDocument(note.legacyBody || ''), 'default');
    await kv.compareAndSet(key(id), 'snapshot', null, encode(Y.encodeStateAsUpdate(initial)));
    initial.destroy();
    updates = await kv.hgetall(key(id));
  }
  const doc = new Y.Doc();
  for (const value of Object.values(updates)) Y.applyUpdate(doc, decode(value, 16 * 1024 * 1024));
  return { doc, updates };
}
export async function syncNote(id, input = {}) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id || '')) fail('회의록을 선택하세요.');
  const { doc, updates } = await load(id);
  try {
    if (input.update) {
      const update = decode(input.update);
      try { Y.applyUpdate(doc, update); } catch { fail('잘못된 문서 변경입니다.'); }
      if (Y.encodeStateAsUpdate(doc).byteLength > 2 * 1024 * 1024) fail('회의록 본문은 2MB까지 저장할 수 있습니다. 이미지는 별도로 업로드하세요.');
      // Immutable, content-addressed changes are safe to retry and never overwrite a peer.
      const updateId = crypto.createHash('sha256').update(update).digest('hex');
      await kv.hset(key(id), updateId, input.update);
    }
    const entries = Object.keys(updates).filter(k => k !== 'snapshot');
    if (entries.length > 32 && await kv.compareAndSet(key(id), 'snapshot', updates.snapshot ?? null, encode(Y.encodeStateAsUpdate(doc)))) {
      await kv.hdel(key(id), ...entries);
    }
    const presenceKey = `${key(id)}:presence`;
    if (typeof input.clientId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(input.clientId)) {
      await kv.hset(presenceKey, input.clientId, JSON.stringify({ name: MEMBERS.includes(input.name) ? input.name : '팀원', at: Date.now() }));
    }
    const presence = await kv.hgetall(presenceKey);
    const active = [], expired = [];
    for (const [clientId, raw] of Object.entries(presence)) {
      const entry = JSON.parse(raw);
      if (Date.now() - entry.at < 15000) active.push({ clientId, name: entry.name });
      else expired.push(clientId);
    }
    if (expired.length) await kv.hdel(presenceKey, ...expired);
    let vector;
    if (input.vector) { try { vector = decode(input.vector, 64000); Y.decodeStateVector(vector); } catch { fail('잘못된 동기화 정보입니다.'); } }
    return { update: encode(Y.encodeStateAsUpdate(doc, vector)), presence: active };
  } finally { doc.destroy(); }
}
