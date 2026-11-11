import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {triggerPrompt,COMMERCIAL_REPORT_INSTRUCTIONS_VERSION} from './commercial-service.js';
import {POLICY_HASH} from './commercial-policy.js';
const batch={id:'fixture-only',period:'2026-10-01',manifest:[{key:'group:prof',network:'prof',source:'fatture'}]};
test('trigger input includes versioned instructions, exact identity and manifest',()=>{
  const prompt=triggerPrompt(batch);
  assert.equal(COMMERCIAL_REPORT_INSTRUCTIONS_VERSION,'2026-11-11.v4');
  for(const s of [batch.id,batch.period,JSON.stringify(batch.manifest),'2026-11-11.v4','BRAIN_STATUS','COMMERCIAL_REPORT_ARTIFACT status','Second Brain–Workspace','ordiniph','nextOffset=null','preflight reale','checksum','riapri ed esporta','esclusivamente PDF, mai DOCX/Word','denominatore verificato','BRAIN_REVIEW','Dopo un diniego interrompi','esito incerto','finalizzazioni seriali','sent con sent_at'])assert.ok(prompt.includes(s),s);
});
test('patch leaves schedule policy hash unchanged and does not retrigger current batch',()=>{
  assert.equal(POLICY_HASH,'ab832d6de1a89216b53099baf3e4483d06044bf9d07fc4ba8224cbe7ee5c5d71');
  const source=readFileSync(new URL('./commercial-service.js',import.meta.url),'utf8');
  assert.ok(source.includes('input:triggerPrompt(batch)'));
  assert.ok(source.includes("if(previous) {"));
  assert.ok(source.includes("return {status:'already_triggered',batchId:previous.id,batchStatus:previous.status}"));
  assert.ok(source.includes("schedule:{day:settings?.delivery_day??2,time:'10:00',timezone:'Europe/Rome'"));
});
