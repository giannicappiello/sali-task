import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startSourceImportReview} from '../src/source-import-ui.mjs';
const owner='11111111-1111-4111-8111-111111111111';
test('source review is read only until human submit and rejects cross-origin writes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'progre-source-test-')),path=join(dir,'archive.json');
 const entries=[{title:'Test',content:'Dato originale',scope:'personal',kind:'historical',source:'second-brain:MEXAL_FINANCE_READ',sourceKey:'source:test'}];
 await writeFile(path,JSON.stringify({format:'second-brain-source-import-v1',ownerId:owner,entries,summary:{company:'GRE',year:2026,note:'<script>untrusted</script>'}}));
 const calls=[];const client={request:async body=>{calls.push(body);if(body.action==='catalog')return {identity:{id:owner}};if(body.action==='source_import_confirmation')return {identity:{id:owner,name:'Test'},receipt:'test-only'};throw Error('No writes expected');}};
 const ui=await startSourceImportReview(client,path,10000);
 try{
  assert.deepEqual(calls.map(x=>x.action),['catalog','source_import_confirmation']);
  const page=await fetch(ui.url),html=await page.text();assert.equal(page.headers.get('referrer-policy'),'same-origin');assert(!html.includes('<script>untrusted'));
  const content=await(await fetch(ui.url+'?archive=1')).json();assert.deepEqual(content.entries,entries);
  const csrf=await fetch(ui.url,{method:'POST',headers:{origin:'https://other.test','Content-Type':'application/x-www-form-urlencoded'},body:'decision=confirm'});assert.equal(csrf.status,403);
  assert.equal(ui.getStatus().imported,0);assert.equal(ui.getStatus().status,'waiting');assert.equal(calls.length,2);
  const rejected=await fetch(ui.url,{method:'POST',headers:{origin:new URL(ui.url).origin,'Content-Type':'application/x-www-form-urlencoded'},body:'decision=reject',redirect:'manual'});assert.equal(rejected.status,303);assert.equal(ui.getStatus().status,'rejected');assert.equal(calls.length,2);
 }finally{ui.close();await rm(dir,{recursive:true,force:true});}
});

for(const changedOwner of [false,true])test(`long imports renew only the exact reviewed commitment, identity changed=${changedOwner}`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'progre-renew-test-')),path=join(dir,'archive.json');
 const entries=[{title:'Test',content:'Dato originale',scope:'personal',kind:'historical',source:'second-brain:MEXAL_FINANCE_READ',sourceKey:'source:test'}];
 await writeFile(path,JSON.stringify({format:'second-brain-source-import-v1',ownerId:owner,entries,summary:{company:'GRE',year:2026}}));
 const calls=[];let confirmations=0;const now=Date.now;let simulated=now();Date.now=()=>simulated;
 const client={request:async body=>{calls.push(body);if(body.action==='catalog')return {identity:{id:owner}};if(body.action==='source_import_confirmation'){confirmations++;return {identity:{id:changedOwner&&confirmations>1?'other':owner,name:'Test'},receipt:'test-only-'+confirmations};}if(body.action==='source_import_batch')return {imported:body.entries.length};throw Error('Unexpected request');}};
 let ui;
 try{
  ui=await startSourceImportReview(client,path,10000);simulated+=3000001;
  // This is an isolated UI unit test with a fake client, never a real approval.
  await fetch(ui.url,{method:'POST',headers:{origin:new URL(ui.url).origin,'Content-Type':'application/x-www-form-urlencoded'},body:'decision=confirm',redirect:'manual'});
  await new Promise(resolve=>setImmediate(resolve));
  const manifests=calls.filter(x=>x.action==='source_import_confirmation').map(x=>x.manifest);assert.equal(manifests.length,2);assert.deepEqual(manifests[0],manifests[1]);
  assert.equal(ui.getStatus().imported,changedOwner?0:1);assert.equal(ui.getStatus().status,changedOwner?'uncertain':'completed');
  assert.equal(calls.filter(x=>x.action==='source_import_batch').length,changedOwner?0:1);
 }finally{Date.now=now;ui?.close();await rm(dir,{recursive:true,force:true});}
});
