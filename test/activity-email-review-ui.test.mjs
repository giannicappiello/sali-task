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
const scope='Autorizzi Progre AI a inviare per tuo conto singole email di testo con il mittente aziendale configurato, soltanto quando lo chiedi espressamente in chat e ai destinatari indicati nella richiesta. Non autorizzi messaggi automatici, ricorrenti, massivi o allegati. Puoi revocare la delega.';
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
