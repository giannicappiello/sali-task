import test from 'node:test';
import assert from 'node:assert/strict';
import {AGENTS,reportPeriod,reportDeliveryDue,subject,resolveRecipients,buildDeliveries,buildReportManifest,sealToken,unsealToken} from './commercial-policy.js';
const users=AGENTS.map((a,i)=>({id:'user-'+i,attivo:true,email:`agent${i}@example.test`,responsabile_utente_id:i>=10?'manager':null}));
users.push({id:'manager',attivo:true,email:'Manager@example.test'});
const agents=AGENTS.map((a,i)=>({codice:a.code,attivo_mexal:true,workspace_utente_id:'user-'+i}));
const makeFiles=r=>buildReportManifest(r).targets.map(t=>({artifact_key:t.key,period:'2026-10-01',source:t.source,network:t.network,bytes:750000,verified:true}));
const files=makeFiles(resolveRecipients(agents,users));

test('late delivery remains due across days, months and years, and never starts early',()=>{
  assert.equal(reportDeliveryDue('2026-10-01',new Date('2026-11-10T08:59:00Z')),false);
  for(const date of ['2026-11-10T09:00:00Z','2026-11-11T00:00:00Z','2027-01-01T00:00:00Z'])assert.equal(reportDeliveryDue('2026-10-01',new Date(date)),true);
  assert.equal(reportDeliveryDue('2027-06-01',new Date('2027-07-02T07:59:00Z'),2),false);
  assert.equal(reportDeliveryDue('2027-06-01',new Date('2027-07-02T08:00:00Z'),2),true);
  assert.equal(reportDeliveryDue('2026-12-01',new Date('2027-01-02T09:00:00Z'),2),true);
  assert.equal(reportPeriod(new Date('2026-12-01T08:00:00Z'),2).due,true);
  assert.equal(reportPeriod(new Date('2026-12-02T09:00:00Z'),2).deliveryDue,true);
  assert.equal(reportPeriod(new Date('2026-12-10T09:00:00Z'),2).due,false);
  assert.throws(()=>reportDeliveryDue('2026-10-31',new Date()),/Mese report/);
});
test('Rome 10:00 follows winter and summer time, with previous-month rollover',()=>{
  assert.deepEqual(reportPeriod(new Date('2026-11-10T09:00:00Z')),{due:true,deliveryDue:true,period:'2026-10-01',month:'ottobre 2026'});
  assert.equal(reportPeriod(new Date('2027-07-10T08:00:00Z')).due,true);
  assert.equal(reportPeriod(new Date('2027-07-10T09:00:00Z')).due,false);
  assert.equal(reportPeriod(new Date('2027-07-10T07:00:00Z')).deliveryDue,false);
  assert.equal(reportPeriod(new Date('2027-07-10T07:00:00Z')).due,true);
  assert.equal(reportPeriod(new Date('2027-01-10T09:00:00Z')).period,'2026-12-01');
  assert.equal(subject('2026-10-01'),'Report Commerciale mese di ottobre 2026');
});
test('agents receive own PDF, manager only linked team, central receives 16 PDFs once',()=>{
  const recipients=resolveRecipients(agents,users),jobs=buildDeliveries('2026-10-01',recipients,files);
  assert.equal(jobs.length,16);
  assert.deepEqual(jobs[0].artifact_keys,['602.00040']);
  const central=jobs.find(j=>j.delivery_key==='aggregate'),manager=jobs.find(j=>j.delivery_key==='manager:manager');
  assert.equal(central.artifact_keys.length,16);
  assert.equal(central.recipient,'ordini@progre.it, giovanni.cappiello@progre.it');
  assert.deepEqual(manager.artifact_keys,[...AGENTS.filter(a=>a.network==='ph').map(a=>a.code).sort(),'group:ph']);
  assert.equal(manager.artifact_keys.includes('group:prof'),false);
  assert.equal(jobs.filter(j=>j.delivery_key==='aggregate').length,1);
  assert.equal(AGENTS.filter(a=>a.source==='ordiniph').length,4);
  assert.equal(AGENTS.some(a=>['602.00058','602.00070','602.00071','602.00072','602.00074'].includes(a.code)),false);
});

test('manager who is also an agent receives one envelope including own report and team only',()=>{
  const ownUsers=users.filter(u=>u.id!=='manager').map(u=>({...u,responsabile_utente_id:u.id==='user-11'?null:u.responsabile_utente_id==='manager'?'user-11':null}));
  const r=resolveRecipients(agents,ownUsers),manifest=buildReportManifest(r),jobs=buildDeliveries('2026-10-01',r,makeFiles(r));
  assert.equal(manifest.targets.length,16); // PH consolidated is reused for the identical team.
  assert.equal(jobs.length,15);
  const own=jobs.filter(j=>j.recipient==='agent11@example.test');
  assert.equal(own.length,1);assert.equal(own[0].artifact_keys.length,5);
  assert.ok(own[0].artifact_keys.includes('602.00052'));
  assert.equal(own[0].artifact_keys.some(k=>k==='group:prof'||AGENTS.find(a=>a.code===k)?.network==='prof'),false);
});

test('partial teams get a dedicated consolidated report, never the full group',()=>{
  const r=resolveRecipients(agents,users.map(u=>({...u,responsabile_utente_id:u.id==='user-10'?'manager':null})));
  const jobs=buildDeliveries('2026-10-01',r,makeFiles(r));
  const m=jobs.find(j=>j.delivery_key==='manager:manager');
  assert.deepEqual(m.artifact_keys,['602.00069','manager:manager:ph']);
  assert.equal(jobs.find(j=>j.delivery_key==='aggregate').artifact_keys.length,16);
});
test('inactive or missing contacts and managers block delivery; no silent recipient substitution',()=>{
  assert.throws(()=>resolveRecipients(agents,users.map(u=>u.id==='user-0'?{...u,attivo:false}:u)),/disattivato/);
  assert.throws(()=>resolveRecipients(agents,users.map(u=>u.id==='manager'?{...u,email:''}:u)),/Email/);
  assert.throws(()=>resolveRecipients(agents,users.map(u=>u.id==='user-0'?{...u,email:'x@example.test\nBcc:bad@example.test'}:u)),/Email/);
});
test('no partial batches, duplicate files, cross-period or cross-source reports',()=>{
  const r=resolveRecipients(agents,users);
  assert.throws(()=>buildDeliveries('2026-10-01',r,files.slice(1)),/incompleto/);
  assert.throws(()=>buildDeliveries('2026-10-01',r,files.map((f,i)=>i===10?{...f,source:'fatture'}:f)),/fonte/);
  assert.throws(()=>buildDeliveries('2026-09-01',r,files),/mese/);
  assert.throws(()=>buildDeliveries('2026-10-01',r,files.map(f=>({...f,bytes:2000000}))),/18 MB/);
});
test('encrypted agent token is bound to owner and authenticates tampering',()=>{
  const sealed=sealToken('test-not-a-real-token','secret','owner');
  assert.equal(unsealToken(sealed,'secret','owner'),'test-not-a-real-token');
  assert.throws(()=>unsealToken(sealed,'secret','other-owner'));
  assert.throws(()=>unsealToken(sealed,'other-secret','owner'));
  assert.equal(sealed.includes('test-not-a-real-token'),false);
});
