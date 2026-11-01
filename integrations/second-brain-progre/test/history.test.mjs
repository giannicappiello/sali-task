import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHistory,redactHistory} from '../src/history.mjs';

test('imports only user/assistant text from ChatGPT and deduplicates stable sources',()=>{
  const data=[{id:'chat-1',title:'Progetto',mapping:{a:{message:{id:'m1',author:{role:'user'},content:{parts:['Decidiamo la consegna']} }},b:{message:{id:'m2',author:{role:'assistant'},content:{parts:['Consegna proposta.']}}},c:{message:{id:'tool',author:{role:'tool'},content:{parts:['private tool output']}}}}}];
  const a=parseHistory(JSON.stringify(data)),b=parseHistory(JSON.stringify(data));
  assert.equal(a.entries.length,2);assert.deepEqual(a.entries.map(e=>e.sourceKey),b.entries.map(e=>e.sourceKey));
  assert(a.entries.every(e=>e.scope==='personal'&&e.kind==='historical'&&e.content.includes('non autorizza')));
  assert(!JSON.stringify(a).includes('private tool output'));
});
test('redacts known credentials before chunking and keeps author/source dates',()=>{
  const text='password=supersecret\n'+('x'.repeat(3100))+'\nsk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
  const data=parseHistory(JSON.stringify({id:'x',messages:[{id:'m',role:'user',text,at:1793548800}]}));
  assert(data.entries.length>1);assert.equal(data.summary.redactedMessages,1);
  assert(!JSON.stringify(data).includes('supersecret'));assert(!JSON.stringify(data).includes('sk-proj-'));
  assert(data.entries.every(e=>e.sourceDate));
});
test('supports local historical JSONL without importing system messages or binary content',()=>{
  const text=[{role:'system',content:[{type:'text',text:'historical system prompt'}]},{role:'user',timestamp:'2026-10-01T10:00:00Z',content:[{type:'text',text:'Decisione aziendale'},{type:'image',data:'binary'}]}].map(JSON.stringify).join('\n');
  const result=parseHistory(text,'archive.jsonl');assert.equal(result.entries.length,1);
  assert(!JSON.stringify(result).includes('historical system prompt'));assert(!JSON.stringify(result).includes('binary'));
});
test('removes JWTs, Windows credentials and private keys',()=>{
  const input='eyJabcdefghijklmno.abcdefghijk.abcdefghijk\n<Objs secret="yes">private</Objs>\n-----BEGIN PRIVATE KEY-----\naaa\n-----END PRIVATE KEY-----';
  const result=redactHistory(input);assert(!result.includes('abcdefghijk'));assert(!result.includes('secret="yes"'));assert(!result.includes('aaa'));
});
