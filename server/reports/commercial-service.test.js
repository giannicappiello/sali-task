import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {PDFDocument} from 'pdf-lib';
import {AGENTS,POLICY_HASH,resolveRecipients,buildReportManifest,recipientsFingerprint} from './commercial-policy.js';
import {reportArtifact,triggerMonthlyReports,dispatchCommercialReports,authorizeReportResend} from './commercial-service.js';
import {claimCommercialEmail} from './commercial-worker.js';

function fixture() {
  const users=AGENTS.map((a,i)=>({id:'u'+i,attivo:true,email:`agent${i}@example.test`,responsabile_utente_id:i>=10&&i!==11?'u11':null}));
  users.push({id:'owner',attivo:true,ruoli:{amministratore_workspace:true}});
  const agents=AGENTS.map((a,i)=>({codice:a.code,attivo_mexal:true,workspace_utente_id:'u'+i}));
  const recipients=resolveRecipients(agents,users),manifest=buildReportManifest(recipients).targets;
  const batch={id:'batch',period:'2026-10-01',owner_id:'owner',policy_hash:POLICY_HASH,status:'requested',manifest,recipients_hash:recipientsFingerprint(recipients)};
  const tables={utenti:users,mexal_agenti:agents,commercial_report_settings:[{singleton:true,enabled:true,owner_id:'owner',policy_hash:POLICY_HASH}],commercial_report_batches:[batch],commercial_report_files:[],commercial_report_chunks:[],commercial_report_emails:[]};
  const db={tables,queueCalls:0,from(name){
    let filters=[],mode='read',payload,single=false;
    const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},neq(k,v){filters.push(r=>r[k]!==v);return q;},in(k,vs){filters.push(r=>vs.includes(r[k]));return q;},order(){return q;},limit(){return q;},maybeSingle(){single=true;return q;},single(){single=true;return q;},insert(v){mode='insert';payload=v;return q;},update(v){mode='update';payload=v;return q;},delete(){mode='delete';return q;},then(resolve,reject){
      try{const matches=r=>filters.every(f=>f(r));let data=tables[name].filter(matches);
        if(mode==='insert'){tables[name].push(payload);data=[payload];}
        if(mode==='update')data.forEach(r=>Object.assign(r,payload));
        if(mode==='delete')tables[name]=tables[name].filter(r=>!matches(r));
        return Promise.resolve({data:single?data[0]||null:data,error:null}).then(resolve,reject);
      }catch(e){return Promise.reject(e).then(resolve,reject);}
    }};return q;
  },async rpc(name,args){
    if(name==='commercial_report_queue'){db.queueCalls++;tables.commercial_report_emails=args.p_jobs;batch.status='queued';return {data:null};}
    if(name==='commercial_report_claim_email')return {data:tables.commercial_report_emails[0]||null};
    if(name==='commercial_report_finish_batch')return {data:false};
    if(name==='commercial_report_authorize_resend'){db.resendArgs=args;return {data:db.requeueResult??true};}
    if(name==='commercial_report_store_pdf'){
      db.storedUpload=args;tables.commercial_report_files.push(args.p_file);
      tables.commercial_report_chunks=tables.commercial_report_chunks.filter(c=>c.batch_id!==args.p_batch||c.artifact_key!==args.p_artifact);
      return {data:true};
    }
    throw new Error('Unexpected RPC '+name);
  }};
  return {auth:{admin:db,profile:{id:'owner',ruoli:{amministratore_workspace:true}}},db,batch,recipients,manifest};
}
async function pdfUpload(target) {
  const doc=await PDFDocument.create();for(let i=0;i<3;i++)doc.addPage();
  const bytes=await doc.save();
  return {batchId:'batch',artifactKey:target.key,period:'2026-10-01',network:target.network,source:target.source,verified:true,sha256:createHash('sha256').update(bytes).digest('hex'),base64:Buffer.from(bytes).toString('base64'),part:0,total:1};
}

test('upload enforces an active owner delegation, unchanged recipients and manifest scope',async()=>{
  const f=fixture(),input=await pdfUpload(f.manifest[0]);
  f.db.tables.commercial_report_settings[0].enabled=false;
  await assert.rejects(()=>reportArtifact(f.auth,{...input,action:'chunk'}),/Nessuna delega/);
  f.db.tables.commercial_report_settings[0].enabled=true;
  await assert.rejects(()=>reportArtifact(f.auth,{...input,action:'chunk',artifactKey:'unknown'}),/fuori dal piano/);
  f.db.tables.utenti[0].email='changed@example.test';
  await assert.rejects(()=>reportArtifact(f.auth,{...input,action:'chunk'}),/variati/);
  assert.equal(f.db.tables.commercial_report_chunks.length,0);
});

test('resend requires explicit duplicate acknowledgement, current recipients and owner delegation; dispatches only a new authorized attempt',async()=>{
 const f=fixture(),input={batchId:'batch',emailId:'00000000-0000-4000-8000-000000000003',requestId:'00000000-0000-4000-8000-000000000004',claimedAt:'2026-11-12T07:01:00Z',reason:'Owner explicitly requested resend after checking receipt',acceptDuplicate:true};
 let dispatches=0;const options={dispatch:async()=>{dispatches++;},schedule:promise=>promise};
 await assert.rejects(()=>authorizeReportResend(f.auth,{...input,acceptDuplicate:false},options),/esplicitamente/);
 assert.equal(f.db.resendArgs,undefined);
 assert.equal((await authorizeReportResend(f.auth,input,options)).status,'resend_queued');assert.equal(dispatches,1);
 f.db.requeueResult=false;
 assert.equal((await authorizeReportResend(f.auth,input,options)).status,'request_already_recorded');assert.equal(dispatches,1);
 f.db.tables.utenti[0].email='changed@example.test';
 await assert.rejects(()=>authorizeReportResend(f.auth,input,options),/variati/);
});

test('complete 16-PDF batch queues manager-restricted envelopes atomically without immediate mail',async()=>{
  const f=fixture(),target=f.manifest.at(-1),input=await pdfUpload(target);
  f.db.tables.commercial_report_files=f.manifest.slice(0,-1).map(t=>({artifact_key:t.key,batch_id:'batch',period:f.batch.period,network:t.network,source:t.source,bytes:1000,verified:true}));
  await reportArtifact(f.auth,{...input,action:'chunk'});
  await assert.rejects(()=>reportArtifact(f.auth,{...input,action:'finalize',source:'fatture'}),/fonte/);
  await assert.rejects(()=>reportArtifact(f.auth,{...input,action:'finalize',sha256:'0'.repeat(64)}),/Integrità/);
  const result=await reportArtifact(f.auth,{...input,action:'finalize'},{now:new Date('2026-11-09T09:00:00Z')});
  assert.equal(result.status,'queued');assert.equal(result.emails,15);assert.equal(f.db.queueCalls,1);
  assert.equal(f.db.tables.commercial_report_chunks.length,0);
  const manager=f.db.tables.commercial_report_emails.find(j=>j.recipient==='agent11@example.test');
  assert.equal(manager.artifact_keys.length,5);assert.equal(manager.artifact_keys.includes('group:prof'),false);
  assert.equal(f.db.tables.commercial_report_emails.find(j=>j.delivery_key==='aggregate').artifact_keys.length,16);
  await assert.rejects(()=>reportArtifact(f.auth,{...input,action:'finalize'}),/già accodato/);
});

test('worker blocks changed contacts before handing off any PDF',async()=>{
  const f=fixture();
  f.db.tables.commercial_report_emails=[{id:'job',batch_id:'batch',delivery_key:'aggregate',recipient:'ordini@progre.it, giovanni.cappiello@progre.it',artifact_keys:[],lock_token:'lock'}];
  f.db.tables.utenti[0].attivo=false;
  await assert.rejects(()=>claimCommercialEmail(f.db,'worker'),/disattivato/);
  assert.equal(f.db.tables.commercial_report_emails[0].status,'failed');
});

test('direct file upload verifies hash and archives/replaces only an explicitly selected unfinished draft',async()=>{
 const f=fixture(),input=await pdfUpload(f.manifest[0]);
 f.db.tables.commercial_report_chunks=[{batch_id:'batch',artifact_key:input.artifactKey,part:0,total:21,base64:'OLD'}];
 const status=await reportArtifact(f.auth,{action:'status',batchId:'batch'});
 const expectedUploadHash=status.missing[0].uploadHash;
 await assert.rejects(()=>reportArtifact(f.auth,{...input,action:'file',expectedUploadHash}),/differisce/);
 await assert.rejects(()=>reportArtifact(f.auth,{...input,action:'file',expectedUploadHash:'stale',replaceIncomplete:true}),/Caricamento variato/);
 await assert.rejects(()=>reportArtifact(f.auth,{...input,action:'file',expectedUploadHash,replaceIncomplete:true,sha256:'0'.repeat(64)}),/Integrità/);
 assert.equal(f.db.storedUpload,undefined);
 const result=await reportArtifact(f.auth,{...input,action:'file',expectedUploadHash,replaceIncomplete:true});
 assert.equal(result.status,'uploaded');assert.equal(f.db.tables.commercial_report_files.length,1);
 assert.equal(f.db.storedUpload.p_actor,'owner');assert.equal(f.db.storedUpload.p_snapshot[0].total,21);
 assert.equal(f.db.tables.commercial_report_chunks.length,0);
 await assert.rejects(()=>reportArtifact(f.auth,{...input,action:'file',expectedUploadHash,sha256:'0'.repeat(64)}),/Esiste già un PDF/);
});

test('status exposes received and missing chunks without revealing contents or sending',async()=>{
 const f=fixture(),key=f.manifest[0].key;
 f.db.tables.commercial_report_chunks=[{batch_id:'batch',artifact_key:key,part:0,total:3},{batch_id:'batch',artifact_key:key,part:2,total:3}];
 const result=await reportArtifact(f.auth,{batchId:'batch',action:'status'});
 assert.deepEqual(result.missing[0].receivedParts,[0,2]);
 assert.deepEqual(result.missing[0].missingParts,[1]);
 assert.equal(result.missing[1].total,null);assert.equal(f.db.queueCalls,0);
});

test('late PDF finalization schedules delivery on the 11th and in subsequent months',async()=>{
 for(const date of ['2026-11-11T12:00:00Z','2026-12-03T12:00:00Z']) {
  const f=fixture(),input=await pdfUpload(f.manifest.at(-1));let dispatched=0;const scheduled=[];
  f.db.tables.commercial_report_files=f.manifest.slice(0,-1).map(t=>({artifact_key:t.key,batch_id:'batch',period:f.batch.period,network:t.network,source:t.source,bytes:1000,verified:true}));
  await reportArtifact(f.auth,{...input,action:'chunk'});
  const result=await reportArtifact(f.auth,{...input,action:'finalize'},{now:new Date(date),dispatch:async()=>{dispatched++;},schedule:promise=>scheduled.push(promise)});
  await Promise.all(scheduled);
  assert.equal(result.dispatch,'dispatch_requested');assert.equal(dispatched,1);assert.equal(f.db.queueCalls,1);
 }
});

test('daily recovery dispatches old queued batches without creating a new run',async()=>{
 const f=fixture();f.batch.status='queued';let dispatched=0;
 const result=await triggerMonthlyReports(f.db,{now:new Date('2026-11-11T09:00:00Z'),dispatch:async()=>{dispatched++;return {status:'dispatch_completed'};},fetchImpl:()=>{throw Error('must not trigger agent');}});
 assert.equal(result.status,'dispatch_requested');assert.deepEqual(result.batchIds,['batch']);
 assert.equal(dispatched,1);assert.equal(f.db.tables.commercial_report_batches.length,1);
 f.db.tables.commercial_report_settings[0].enabled=false;
 assert.equal((await triggerMonthlyReports(f.db,{dispatch:async()=>{throw Error('disabled');}})).status,'not_due');
});

test('worker per-message uncertainty is not reported as completed dispatch',async()=>{
 const env=globalThis.process.env,oldUrl=env.ARUBA_EMAIL_WORKER_URL,oldSecret=env.ARUBA_EMAIL_WORKER_SECRET;
 env.ARUBA_EMAIL_WORKER_URL='https://example.test/worker';env.ARUBA_EMAIL_WORKER_SECRET='fixture';
 try {
  await assert.rejects(()=>dispatchCommercialReports(async(_url,options)=>Response.json(options.method==='GET'?{report_protocol:1,queue_enabled:true}:{status:'ok',results:[{status:'uncertain'}]})),/Non ripetere invii incerti/);
 } finally {
  if(oldUrl===undefined)delete env.ARUBA_EMAIL_WORKER_URL;else env.ARUBA_EMAIL_WORKER_URL=oldUrl;
  if(oldSecret===undefined)delete env.ARUBA_EMAIL_WORKER_SECRET;else env.ARUBA_EMAIL_WORKER_SECRET=oldSecret;
 }
});
