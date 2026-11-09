import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {proposeActivityEmail, decideActivityEmail, hashActivityEmail, getActivityEmail} from './activity-email-service.js';
const id = '11111111-1111-4111-8111-111111111111';
const input = {taskId: id, recipient:'user@example.test', subject:'Sollecito', body:'Testo', idempotencyKey:'request_123'};
test('proposal uses scoped RPC, ignores cached AI entitlements and requires explicit option', async () => {
 const calls=[]; const auth={scoped:{rpc: async (...args)=>{calls.push(args);return {data:{id}};}}};
 assert.deepEqual(await proposeActivityEmail(auth,input,{viaAI:true}),{id});
 assert.equal(calls[0][1].p_via_ai,true);
 await assert.rejects(proposeActivityEmail(auth,{...input,viaAI:false}), /Campi/);
 assert.equal(calls.length,1);
});
test('rejects multiple recipients, header injection, empty or long body and attachments before RPC', async () => {
 const auth={scoped:{rpc:()=>assert.fail('must not call database')}};
 for(const invalid of [{recipient:'a@example.test,b@example.test'},{recipient:'Name <a@example.test>'},{subject:'Hi\r\nBcc: bad@example.test'},{subject:'x'.repeat(201)},{body:' '},{body:'x'.repeat(12001)},{attachments:[]}]) await assert.rejects(proposeActivityEmail(auth,{...input,...invalid}));
});
test('decision is explicit, hash is DB payload hash and SQL errors are sanitized', async()=>{
 const calls=[];const auth={scoped:{rpc:async(...args)=>{calls.push(args);return {error:{message:'SQL contains private data'}};}}};
 await assert.rejects(decideActivityEmail(auth,{id,confirm:'true',expectedHash:'a'.repeat(64)}));
 assert.equal(calls.length,0);
 await assert.rejects(decideActivityEmail(auth,{id,confirm:true,expectedHash:'a'.repeat(64)}),e=>e.status===500&&!e.message.includes('private'));
 assert.equal(hashActivityEmail({payload_hash:'a'.repeat(64)}),'a'.repeat(64));
 assert.equal(calls[0][1].p_confirm,true);
});
test('history fetch never selects delivery tokens', async()=>{
 const query={select:columns=>{assert.ok(!columns.includes('lock_token'));assert.ok(!columns.includes('worker_id'));return query;},eq:()=>query,maybeSingle:async()=>({data:{id}})};
 assert.equal((await getActivityEmail({scoped:{from:()=>query}},id)).id,id);
});
const migration = await readFile(new URL('../../supabase/migrations/20261108123140_activity_email.sql',import.meta.url),'utf8');
test('schema boundaries: no role grants, separate private attempts, RLS and irreversible claim',()=>{
 assert.match(migration,/alter table public.workspace_emails enable row level security/);
 assert.match(migration,/revoke all on public.workspace_emails,public.workspace_email_delivery from public,anon,authenticated/);
 assert.doesNotMatch(migration,/insert into public.permessi_(utente|ruolo)/i);
 assert.match(migration,/for update skip locked/);
 assert.match(migration,/status='sending',claimed_at=now\(\)/);
 assert.match(migration,/status='uncertain',error_code='CLAIM_TIMEOUT'/);
 assert.doesNotMatch(migration,/grant.*workspace_claim_email.*to authenticated/);
});

test('activity supports To/CC arrays without losing roles and rejects ambiguous legacy input',async()=>{
 const calls=[];const auth={scoped:{rpc:async(...args)=>{calls.push(args);return {data:{id}};}}};
 const multi={taskId:id,to:['ONE@example.test','two@example.test'],cc:['copy@example.test'],subject:'S',body:'B',idempotencyKey:'request_multi'};
 await proposeActivityEmail(auth,multi,{viaAI:true});
 assert.equal(calls[0][0],'workspace_propose_activity_email_v2');
 assert.deepEqual(calls[0][1].p_to,['one@example.test','two@example.test']);assert.deepEqual(calls[0][1].p_cc,['copy@example.test']);
 assert.equal(calls[0][1].p_via_ai,true);
 await assert.rejects(proposeActivityEmail(auth,{...multi,recipient:'one@example.test'}));
 await assert.rejects(proposeActivityEmail(auth,{...multi,cc:['one@example.test']}));assert.equal(calls.length,1);
});
