import test from 'node:test';
import assert from 'node:assert/strict';
import { readConversationPage } from './conversation-history.js';
const id='00000000-0000-4000-8000-000000000001';
function db(rows, owned=true) {
  const calls=[];
  const admin={from(table){
    calls.push(['from',table]);
    const query={
      maybeSingle:async()=>({data:owned?{id}:null}),
      then:resolve=>resolve({data:rows}),
    };
    for(const method of ['select','eq','order','limit','or'])query[method]=(...args)=>{calls.push([method,...args]);return query;};
    return query;
  }};
  return {admin,calls};
}
test('history never reads messages belonging to another user',async()=>{
  const {admin,calls}=db([],false);
  await assert.rejects(readConversationPage(admin,'owner',id),{status:404});
  assert.deepEqual(calls.filter(c=>c[0]==='from'),[['from','ai_conversazioni']]);
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='utente_id'&&c[2]==='owner'));
});
test('pages newest messages with stable cursor and chronological display',async()=>{
  const rows=Array.from({length:51},(_,i)=>({id:`00000000-0000-4000-8000-${String(100-i).padStart(12,'0')}`,creato_il:'2026-09-23T12:00:00.123456+00:00'}));
  const {admin,calls}=db(rows);
  const page=await readConversationPage(admin,'owner',id);
  assert.equal(page.messages.length,50);
  assert.equal(page.messages[0].id,rows[49].id);
  assert.equal(page.messages.at(-1).id,rows[0].id);
  assert.deepEqual(page.nextCursor,{at:rows[49].creato_il,id:rows[49].id});
  await readConversationPage(admin,'owner',id,page.nextCursor);
  assert.ok(calls.some(c=>c[0]==='or'&&c[1].includes(`id.lt.${rows[49].id}`)));
});
test('rejects cursor injection and finishes at last page',async()=>{
  const {admin,calls}=db([]);
  await assert.rejects(readConversationPage(admin,'owner',id,{id,at:'now),utente_id.neq.owner'}),{status:400});
  assert.equal(calls.some(c=>c[0]==='or'),false);
  assert.equal((await readConversationPage(admin,'owner',id)).nextCursor,null);
});
