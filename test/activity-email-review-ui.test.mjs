import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { transformWithOxc } from 'vite';
const window = new Window({ url: 'http://localhost/assistente-ai?view=review&kind=email&proposalId=mail-1' });
for (const name of ['window','document','navigator','HTMLElement','Event','MouseEvent','location']) Object.defineProperty(globalThis,name,{ configurable:true,value:name==='window'?window:window[name] });
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const { default: React, act }=await import('react');
const { createRoot }=await import('react-dom/client');
const require=createRequire(import.meta.url);
let source=await readFile(new URL('../src/pages/AIAssistant/OnlineConnection.jsx',import.meta.url),'utf8');
const requestSource=source.slice(source.indexOf('async function brainRequest('),source.indexOf('const authorization='));
const realClientWithFetch=fetchMock=>new Function('fetch',requestSource+';return brainRequest;')(fetchMock);
source=source.replace(/import \{createClient\} from '@supabase\/supabase-js';/, 'const createClient = () => { throw new Error("No real authentication in fixture"); };')
 .replace(/import \{useAuth\} from '[^']+';/, 'const useAuth = () => globalThis.reviewFixture.auth;')
 .replace(/import \{\s*useLocation\s*\} from '[^']+';/, 'const useLocation = () => ({search: globalThis.reviewFixture.search});')
 .replace(/import '\.\/second-brain.css';/, '')
 .replace(/async function brainRequest[\s\S]*?(?=const authorization=)/, 'const brainRequest = (...args) => globalThis.reviewFixture.request(...args);\n');
const transformed=await transformWithOxc(source,'OnlineConnection.jsx',{jsx:{runtime:'automatic'}});
const code=transformed.code.replace(/(["'])(react(?:\/jsx-runtime)?)\1/g,(_,q,spec)=>JSON.stringify(pathToFileURL(require.resolve(spec)).href));
const {OnlineReview}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const session={user:{id:'user-1',email:'fixture@example.com'},access_token:'not-a-real-token'};
const proposal=id=>({id,recipient:'recipient@example.com',subject:'Oggetto '+id,body:'Testo completo\nSeconda riga',status:'proposed'});
const prepared=id=>({proposal:proposal(id),receipt:'receipt-'+id,identity:{name:'Utente sintetico'},terminal:false});
const delegation={id:'delegation-1',user_id:'user-1',status:'proposed',policy_version:'chat-email-v1',policy_hash:'fixture-hash'};
const delegationPrepared=()=>({...prepared('delegation-1'),proposal:{...delegation}});
const scope='Autorizzi Progre AI a inviare per tuo conto una email di testo a un solo destinatario, senza CC, con il mittente aziendale configurato, soltanto quando lo chiedi espressamente in chat. Non autorizzi messaggi automatici, ricorrenti, massivi o allegati. Puoi revocare la delega.';
const authorize='Autorizzo gli invii richiesti in chat';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let root,host;
async function mount(request,kind='email',id='mail-1'){globalThis.reviewFixture={auth:{session},search:`?view=review&kind=${kind}&proposalId=${id}`,request};host=document.createElement('div');document.body.append(host);root=createRoot(host);await render();}
async function render(){await act(async()=>{root.render(React.createElement(OnlineReview));await tick();});}
async function cleanup(){if(root)await act(async()=>root.unmount());host?.remove();root=null;}
const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
async function click(text,twice=false){await act(async()=>{const b=button(text);assert.ok(b,text);b.click();if(twice)b.click();await tick();});}
async function consent(){await act(async()=>{host.querySelector('input[type=checkbox]').click();await tick();});}

test('email preview requires explicit decision and double click records one confirmation',async()=>{
 const calls=[];
 try{
  await mount(async(s,input)=>{calls.push(input);return input.action==='confirmation'?prepared(input.id):{email:{...proposal('mail-1'),status:'queued'}};});
  assert.equal(host.querySelector('h1').textContent,'Conferma email');
  assert.match(host.textContent,/recipient@example.com/);assert.match(host.textContent,/Seconda riga/);
  assert.equal(calls.filter(c=>c.action==='decide').length,0);
  await click('Conferma e invia email',true);
  assert.deepEqual(calls.filter(c=>c.action==='decide'),[{action:'decide',receipt:'receipt-mail-1',decision:'confirm'}]);
  assert.match(host.textContent,/Accodata/);assert.match(host.textContent,/non dimostra la consegna/);
 }finally{await cleanup();}
});

test('email timeout leaves decision buttons disabled and never retries',async()=>{
 const calls=[];
 try{
  await mount(async(s,input)=>{calls.push(input);if(input.action==='confirmation')return prepared(input.id);throw Error('Simulated timeout');});
  await click('Conferma e invia email');assert.match(host.textContent,/Esito da verificare/);
  assert.equal(button('Conferma e invia email').disabled,true);assert.equal(button('Rifiuta').disabled,true);
  await click('Conferma e invia email');assert.equal(calls.filter(c=>c.action==='decide').length,1);
 }finally{await cleanup();}
});

test('navigation isolates old pending decision and uses only new receipt',async()=>{
 let finishOld;const calls=[];
 try{
  await mount(async(s,input)=>{calls.push(input);if(input.action==='confirmation')return prepared(input.id);if(input.receipt==='receipt-mail-1')return new Promise(resolve=>{finishOld=resolve;});return {email:{...proposal('mail-2'),status:'rejected'}};});
  await click('Conferma e invia email');
  reviewFixture.search='?view=review&kind=email&proposalId=mail-2';await render();
  assert.match(host.textContent,/Oggetto mail-2/);assert.doesNotMatch(host.textContent,/Oggetto mail-1/);assert.equal(button('Rifiuta').disabled,false);
  await act(async()=>{finishOld({email:{...proposal('mail-1'),status:'accepted'}});await tick();});
  assert.match(host.textContent,/Oggetto mail-2/);assert.doesNotMatch(host.textContent,/Accettata dal server/);
  await click('Rifiuta');assert.equal(calls.filter(c=>c.action==='decide')[1].receipt,'receipt-mail-2');
 }finally{await cleanup();}
});

test('delegation scope exact, checkbox unchecked, no automatic consent, one decision after explicit consent',async()=>{
 const calls=[];
 try{
  await mount(async(s,input)=>{calls.push(input);return input.action==='confirmation'?delegationPrepared():{delegation:{...delegation,status:'active'}};},'email-delegation','delegation-1');
  assert.ok(host.textContent.includes(scope));assert.equal(host.querySelector('input').checked,false);assert.equal(button(authorize).disabled,true);
  await click(authorize);assert.equal(calls.filter(c=>c.action==='decide').length,0);
  await consent();assert.equal(button(authorize).disabled,false);await click(authorize,true);
  assert.deepEqual(calls.filter(c=>c.action==='decide'),[{action:'decide',receipt:'receipt-delegation-1',decision:'confirm'}]);
  assert.match(host.textContent,/Delega attiva/);assert.equal(host.querySelector('input'),null);
 }finally{await cleanup();}
});

test('delegation rejection needs no checkbox and never claims active',async()=>{
 const calls=[];
 try{
  await mount(async(s,input)=>{calls.push(input);return input.action==='confirmation'?delegationPrepared():{delegation:{...delegation,status:'revoked'}};},'email-delegation','delegation-1');
  await click('Non autorizzo');assert.equal(calls.find(c=>c.action==='decide').decision,'reject');assert.match(host.textContent,/La delega non risulta attiva/);assert.doesNotMatch(host.textContent,/Delega attiva\./);
 }finally{await cleanup();}
});

test('unknown delegation policy cannot be accepted and terminal active delegation cannot be reactivated',async()=>{
 try{
  await mount(async()=>({...delegationPrepared(),proposal:{...delegation,policy_version:'unknown'}}),'email-delegation','delegation-1');
  assert.equal(button(authorize).disabled,true);assert.equal(host.querySelector('input').disabled,true);assert.match(host.textContent,/non è riconosciuta/);
 }finally{await cleanup();}
 try{
  await mount(async()=>({...delegationPrepared(),terminal:true,proposal:{...delegation,status:'active'}}),'email-delegation','delegation-1');
  assert.equal(button(authorize),undefined);assert.equal(host.querySelector('input'),null);assert.match(host.textContent,/Attiva/);
 }finally{await cleanup();}
});

test('changing user resets delegation consent and ignores old confirmation',async()=>{
 let finishOld;
 try{
  await mount(async(s,input)=>s.user.id==='user-1'?delegationPrepared():new Promise(resolve=>{finishOld=resolve;}),'email-delegation','delegation-1');
  await consent();assert.equal(host.querySelector('input').checked,true);
  reviewFixture.auth={session:{...session,user:{id:'user-2',email:'second@example.com'}}};await render();
  assert.equal(host.querySelector('input'),null);
  await act(async()=>{finishOld({...delegationPrepared(),proposal:{...delegation,user_id:'user-2'}});await tick();});
  assert.equal(host.querySelector('input').checked,false);assert.equal(button(authorize).disabled,true);
 }finally{await cleanup();}
});

test('delegation timeout never retries and email provider errors display safe text',async()=>{
 const calls=[];
 try{
  await mount(async(s,input)=>{calls.push(input);if(input.action==='confirmation')return delegationPrepared();throw Error('Simulated timeout');},'email-delegation','delegation-1');
  await consent();await click(authorize);assert.match(host.textContent,/stato della delega/);assert.equal(button(authorize).disabled,true);assert.equal(button('Non autorizzo').disabled,true);assert.equal(calls.filter(c=>c.action==='decide').length,1);
 }finally{await cleanup();}
 try{
  await mount(async()=>({...prepared('mail-1'),terminal:true,proposal:{...proposal('mail-1'),status:'failed',error_code:'provider_rejected'}}));
  assert.match(host.textContent,/Il servizio email ha rifiutato/);assert.doesNotMatch(host.textContent,/provider_rejected/);
 }finally{await cleanup();}
});

test('active delegation supports explicit human revocation only in server revoke mode',async()=>{
 const calls=[];
 try{
  await mount(async(s,input)=>{calls.push(input);return input.action==='confirmation'?{...delegationPrepared(),mode:'revoke',terminal:false,proposal:{...delegation,status:'active'}}:{delegation:{...delegation,status:'revoked'}};},'email-delegation','delegation-1');
  assert.equal(host.querySelector('input'),null);assert.equal(button(authorize),undefined);assert.equal(button('Non autorizzo'),undefined);
  assert.equal(calls.filter(c=>c.action==='decide').length,0);
  await click('Revoca delega email',true);
  assert.deepEqual(calls.filter(c=>c.action==='decide'),[{action:'decide',receipt:'receipt-delegation-1',decision:'reject'}]);
  assert.match(host.textContent,/La delega non risulta attiva/);assert.equal(button('Revoca delega email'),undefined);
 }finally{await cleanup();}
});

for(const kind of ['email','email-delegation']) test(`${kind} transport gate 409 is definitive: explicit retry only and no duplicate writes`,async()=>{
 let ready=false,decisions=0,writes=0;const receipts=[];
 const client=realClientWithFetch(async(url,options)=>{
  const input=JSON.parse(options.body);
  if(input.action==='confirmation')return {ok:true,status:200,json:async()=>kind==='email'?prepared(input.id):delegationPrepared()};
  decisions++;receipts.push(input.receipt);
  if(!ready)return {ok:false,status:409,json:async()=>({success:false,code:'EMAIL_TRANSPORT_NOT_READY',error:'SECRET_RAW_PROVIDER_DETAIL'})};
  writes++;
  return {ok:true,status:200,json:async()=>kind==='email'?{email:{...proposal('mail-1'),status:'queued'}}:{delegation:{...delegation,status:'active'}}};
 });
 try{
  await mount(client,kind,kind==='email'?'mail-1':'delegation-1');
  const label=kind==='email'?'Conferma e invia email':authorize;
  if(kind==='email-delegation')await consent();
  await click(label,true);
  assert.equal(decisions,1);assert.equal(writes,0);
  assert.match(host.textContent,/servizio email non è ancora pronto/);assert.match(host.textContent,/Nessuna email è stata accodata|nessuna email è stata accodata/);
  assert.doesNotMatch(host.textContent,/SECRET_RAW_PROVIDER_DETAIL|Esito.*da verificare/);
  assert.equal(button(label).disabled,false);
  if(kind==='email-delegation'){assert.equal(host.querySelector('input').checked,true);assert.match(host.textContent,/delega non è stata attivata/);}
  await tick();assert.equal(decisions,1);
  await click(label,true);assert.equal(decisions,2);assert.equal(writes,0);
  ready=true;await click(label,true);assert.equal(decisions,3);assert.equal(writes,1);
  assert.equal(new Set(receipts).size,1);
 }finally{await cleanup();}
});

test('only exact HTTP 409 and known code allow retry; arbitrary server details stay hidden',async()=>{
 for(const response of [
  {status:500,code:'EMAIL_TRANSPORT_NOT_READY'},
  {status:409,code:'SOME_OTHER_FAILURE'},
 ]){
  let decisions=0;
  const client=realClientWithFetch(async(url,options)=>{
   const input=JSON.parse(options.body);
   if(input.action==='confirmation')return {ok:true,status:200,json:async()=>prepared(input.id)};
   decisions++;return {ok:false,status:response.status,json:async()=>({success:false,code:response.code,error:'PRIVATE_CONFIGURATION_VALUE'})};
  });
  try{
   await mount(client);await click('Conferma e invia email');
   assert.match(host.textContent,/Esito da verificare/);assert.doesNotMatch(host.textContent,/PRIVATE_CONFIGURATION_VALUE|Nessuna email è stata accodata/);
   assert.equal(button('Conferma e invia email').disabled,true);await click('Conferma e invia email');assert.equal(decisions,1);
  }finally{await cleanup();}
 }
});

test('unknown confirmation read errors do not render arbitrary server messages',async()=>{
 const client=realClientWithFetch(async()=>({ok:false,status:500,json:async()=>({success:false,error:'PRIVATE_READ_ERROR_DETAIL'})}));
 try{await mount(client);assert.doesNotMatch(host.textContent,/PRIVATE_READ_ERROR_DETAIL/);assert.match(host.textContent,/Operazione non completata/);assert.equal(button('Conferma e invia email'),undefined);}finally{await cleanup();}
});

const recipients = label => [...host.querySelectorAll(`ul[aria-label="Destinatari ${label}"] > li`)].map(node => node.textContent);
const multiProposal = id => ({ ...proposal(id), recipient: 'legacy-not-an-extra@example.com',
 to_recipients: Array.from({ length: 16 }, (_, index) => `to-${index + 1}@example.com`),
 cc_recipients: Array.from({ length: 14 }, (_, index) => `cc-${index + 1}@example.com`), transport_protocol_version: 3 });

test('multi-recipient review shows every To and CC, keeps content immutable and submits only the signed receipt', async () => {
 const email = multiProposal('mail-1'), calls = [];
 try {
  await mount(async (_session, input) => {
   calls.push(input);
   return input.action === 'confirmation' ? { ...prepared(input.id), proposal: email, receipt: 'receipt-binding-all-addresses-and-body' } : { email: { ...email, status: 'queued' } };
  });
  assert.deepEqual(recipients('A (To)'), email.to_recipients);
  assert.deepEqual(recipients('CC'), email.cc_recipients);
  assert.doesNotMatch(host.textContent, /legacy-not-an-extra/);
  assert.equal(host.querySelector('input, textarea, [contenteditable="true"]'), null);
  assert.match(host.textContent, /Controlla tutti i destinatari/);
  await click('Conferma e invia email', true);
  assert.deepEqual(calls.filter(c => c.action === 'decide'), [{ action: 'decide', receipt: 'receipt-binding-all-addresses-and-body', decision: 'confirm' }]);
  assert.deepEqual(recipients('A (To)'), email.to_recipients);
  assert.deepEqual(recipients('CC'), email.cc_recipients);
 } finally { await cleanup(); }
});

test('legacy recipient and null CC remain reviewable without invented recipients', async () => {
 for (const fields of [
  { to_recipients: null, cc_recipients: null, transport_protocol_version: 1 },
  { to_recipients: ['canonical@example.com'], cc_recipients: null, transport_protocol_version: 2 },
  { to_recipients: ['canonical@example.com'], cc_recipients: [], transport_protocol_version: 2 },
 ]) {
  try {
   await mount(async () => ({ ...prepared('mail-1'), proposal: { ...proposal('mail-1'), ...fields } }));
   assert.deepEqual(recipients('A (To)'), fields.to_recipients || ['recipient@example.com']);
   assert.deepEqual(recipients('CC'), []);
   assert.match(host.textContent, /CC:Nessuno/);
   assert.equal(button('Conferma e invia email').disabled, false);
  } finally { await cleanup(); }
 }
});

test('email review renders addresses, subject and body as plain text, never HTML', async () => {
 const injected = '<img src=x onerror="globalThis.emailInjected=true">';
 try {
  await mount(async () => ({ ...prepared('mail-1'), proposal: { ...multiProposal('mail-1'), to_recipients: [injected], cc_recipients: ['<script>alert(1)</script>'], subject: injected, body: '<a href="javascript:alert(1)">test</a>' } }));
  assert.deepEqual(recipients('A (To)'), [injected]);
  assert.deepEqual(recipients('CC'), ['<script>alert(1)</script>']);
  assert.equal(host.querySelector('img, script, a'), null);
  assert.equal(globalThis.emailInjected, undefined);
 } finally { await cleanup(); }
});

test('v2 scope and consent describe To/CC and the total limit, without inheriting v1 consent', async () => {
 const calls = [], row = { ...delegation, id: 'delegation-2', policy_version: 'chat-email-v2' };
 try {
  await mount(async (_session, input) => {
   calls.push(input);
   if (input.action === 'confirmation') return { ...prepared(input.id), proposal: input.id === 'delegation-1' ? delegation : row };
   return { delegation: { ...row, status: 'active' } };
  }, 'email-delegation', 'delegation-1');
  await consent();
  reviewFixture.search = '?view=review&kind=email-delegation&proposalId=delegation-2'; await render();
  assert.match(host.textContent, /uno o più destinatari in A \(To\) e CC, fino a 10 indirizzi complessivi/);
  assert.match(host.textContent, /visibili agli altri destinatari/);
  assert.match(host.textContent, /non viene estesa automaticamente/);
  assert.equal(host.querySelector('input').checked, false);
  assert.equal(button(authorize).disabled, true);
  await click(authorize); assert.equal(calls.filter(c => c.action === 'decide').length, 0);
  await consent(); await click(authorize, true);
  assert.deepEqual(calls.filter(c => c.action === 'decide'), [{ action: 'decide', receipt: 'receipt-delegation-2', decision: 'confirm' }]);
 } finally { await cleanup(); }
});

test('v3 scope and consent describe To/CC and the total limit, without inheriting v2 consent', async () => {
 const calls = [], row = { ...delegation, id: 'delegation-3', policy_version: 'chat-email-v3' };
 try {
  await mount(async (_session, input) => {
   calls.push(input);
   if (input.action === 'confirmation') return { ...prepared(input.id), proposal: input.id === 'delegation-1' ? { ...delegation, policy_version: 'chat-email-v2' } : row };
   return { delegation: { ...row, status: 'active' } };
  }, 'email-delegation', 'delegation-1');
  await consent();
  reviewFixture.search = '?view=review&kind=email-delegation&proposalId=delegation-3'; await render();
  assert.match(host.textContent, /uno o più destinatari in A \(To\) e CC, fino a 30 indirizzi complessivi/);
  assert.match(host.textContent, /visibili agli altri destinatari/);
  assert.match(host.textContent, /non vengono estese automaticamente/);
  assert.equal(host.querySelector('input').checked, false);
  assert.equal(button(authorize).disabled, true);
  await click(authorize); assert.equal(calls.filter(c => c.action === 'decide').length, 0);
  await consent(); await click(authorize, true);
  assert.deepEqual(calls.filter(c => c.action === 'decide'), [{ action: 'decide', receipt: 'receipt-delegation-3', decision: 'confirm' }]);
 } finally { await cleanup(); }
});

test('Back/Forward between reviews reloads canonical state and never repeats an accepted email', async () => {
 const calls = [], statuses = { 'mail-1': 'proposed', 'mail-2': 'proposed' };
 try {
  await mount(async (_session, input) => {
   calls.push(input);
   if (input.action === 'confirmation') return { ...prepared(input.id), proposal: { ...multiProposal(input.id), status: statuses[input.id] }, terminal: statuses[input.id] !== 'proposed' };
   statuses['mail-1'] = 'queued'; return { email: { ...multiProposal('mail-1'), status: 'queued' } };
  });
  await click('Conferma e invia email');
  reviewFixture.search = '?view=review&kind=email&proposalId=mail-2'; await render();
  reviewFixture.search = '?view=review&kind=email&proposalId=mail-1'; await render();
  assert.match(host.textContent, /Oggetto mail-1/); assert.match(host.textContent, /Accodata/);
  assert.equal(button('Conferma e invia email'), undefined);
  reviewFixture.search = '?view=review&kind=email&proposalId=mail-2'; await render();
  assert.match(host.textContent, /Oggetto mail-2/); assert.equal(button('Conferma e invia email').disabled, false);
  assert.equal(calls.filter(c => c.action === 'decide').length, 1);
  assert.equal(calls.filter(c => c.action === 'confirmation').length, 4);
 } finally { await cleanup(); }
});

test('Back/Forward or a refreshed receipt clears v2 consent and cannot automate activation', async () => {
 const calls = []; let revision = 1;
 try {
  await mount(async (_session, input) => {
   calls.push(input);
   return { ...prepared(input.id), receipt: `receipt-${input.id}-${revision}`, proposal: { ...delegation, id: input.id, policy_version: 'chat-email-v2' } };
  }, 'email-delegation', 'delegation-1');
  await consent();
  for (const id of ['delegation-2', 'delegation-1', 'delegation-2']) {
   reviewFixture.search = `?view=review&kind=email-delegation&proposalId=${id}`; await render();
   assert.equal(host.querySelector('input').checked, false); assert.equal(button(authorize).disabled, true);
   await consent();
  }
  revision++;
  reviewFixture.auth = { session: { ...session, access_token: 'refreshed-fixture-token' } }; await render();
  assert.equal(host.querySelector('input').checked, false); assert.equal(button(authorize).disabled, true);
  assert.equal(calls.filter(c => c.action === 'decide').length, 0);
 } finally { await cleanup(); }
});

test('multi-recipient timeout preserves the exact review and blocks both repeated decisions', async () => {
 const email = multiProposal('mail-1'), calls = [];
 try {
  await mount(async (_session, input) => {
   calls.push(input);
   if (input.action === 'confirmation') return { ...prepared(input.id), proposal: email };
   throw Error('Simulated timeout');
  });
  await click('Conferma e invia email', true);
  assert.deepEqual(recipients('A (To)'), email.to_recipients); assert.deepEqual(recipients('CC'), email.cc_recipients);
  assert.match(host.textContent, /Esito da verificare/);
  await click('Conferma e invia email'); await click('Rifiuta');
  assert.equal(calls.filter(c => c.action === 'decide').length, 1);
 } finally { await cleanup(); }
});
