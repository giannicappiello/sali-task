import test from 'node:test';
import assert from 'node:assert/strict';
import {economicClass,incomeStatement,mexalIncomeStatementTools,collectIncomeSource} from './mexal-conto-economico.js';
import {createBridge} from '../../integrations/second-brain-progre/src/server.mjs';
import {onlineStatus} from './online-handler.js';
const auth={profile:{id:'personal',ruoli:{amministratore_workspace:true}},capabilities:{internal_data:true},scoped:{rpc:async n=>({data:n==='workspace_user_is_admin'?true:{mode:'tutti'}})}};
const chart=[['sales','A1'],['services','B7'],['depreciation','B10B'],['inventory','B11'],['bank','CIV1'],['vat','D12A'],['interest','C17E'],['tax','20A']].map(([codice,ue])=>({codice,ragione_sociale:codice,bil_34dir_ue_d:ue,bil_34dir_ue_a:''}));
const row=(code,amount,progressivo=1,cau_contabile='FE',data_registr='20260102')=>({codice_conto:code,importo_riga:amount,progressivo,cau_contabile,data_registr});
const rows=[row('sales','-100.000001'),row('vat','-22'),row('bank','122.000001'),row('services','20',2),row('bank','-20',2),row('depreciation','10',3,'BA'),row('bank','-10',3,'BA')];
const headersOf=lines=>[...new Map(lines.map(r=>[r.data_registr+'|'+r.progressivo,{data_registr:r.data_registr,progressivo:r.progressivo,cau_contabile:r.cau_contabile}])).values()];
function run(lines=rows,overrides={}){
 return incomeStatement({chart:{rows:chart,complete:true},journal:{rows:lines,complete:true},headers:{rows:headersOf(lines),complete:true},period:{from:'2026-01-01',to:'2026-10-31'},sources:[],principalId:'personal',company:'GRE',input:{},...overrides});
}
test('exact registered components exclude VAT and patrimonial rows, retain BA, never attest accrual margins',()=>{
 const r=run();assert.equal(r.ricavi.registeredAmount,'100.000001');assert.equal(r.ricavi.amount,null);assert.equal(r.registeredOperatingDifference.amount,'70.000001');assert.equal(r.coverage.retainedBARows,2);
 assert.equal(r.costiPerNatura.find(c=>c.classification==='B7').registeredAmount,'20.00');assert.equal(r.EBITDA.amount,null);assert.equal(r.EBIT.amount,null);assert.equal(r.anteImposte.amount,null);assert.equal(r.rimanenze.opening,null);assert.equal(r.rimanenze.registeredVariations.B11.registeredAmount,null);assert.equal(r.currency,undefined);assert.equal(r.complete,false);assert.equal(r.recordedCoverageComplete,true);
});
test('current UE codes only: financial, currency exchange, taxes; no names, prefixes or old CEE',()=>{
 for(const code of ['A1','A5B','B9A','B10D','C17E','C17BISA','C16D5','D18A','20A'])assert.equal(economicClass(code).kind,'economic',code);
 for(const code of ['AI','AIX1','BI1','B1','B4','C','CIV1','CII5QUATA','D4A','D12A','E'])assert.equal(economicClass(code).kind,'balanceSheet',code);
 for(const code of ['',null,'Ricavi','A10','C17EVIL/','E20','B15'])assert.equal(economicClass(code).kind,'unknown');
 const r=run(rows,{chart:{complete:true,rows:chart.map(a=>a.codice==='sales'?{codice:'sales',ragione_sociale:'RICAVI CERTO',bil_ivdir_cee_d:'A1'}:a)}});assert.equal(r.ricavi.registeredAmount,null);assert.equal(r.coverage.unknownAccounts,1);
});
test('credit notes, reversal of expenses, zero-net accounts and AP/CH exclusions preserve signs',()=>{
 const lines=[...rows,row('sales','5',4,'NE'),row('bank','-5',4,'NE'),row('services','-2',5,'NR'),row('bank','2',5,'NR'),row('sales','999',6,'CH'),row('bank','-999',6,'CH'),row('bank','100',7,'AP','20260101'),row('vat','-100',7,'AP','20260101')];
 const r=run(lines);assert.equal(r.ricavi.registeredAmount,'95.000001');assert.equal(r.costiPerNatura.find(c=>c.classification==='B7').registeredAmount,'18.00');assert.equal(r.coverage.excludedAPCHRows,4);
 const z=run([row('sales',5),row('sales',-5)]);assert.equal(z.ricavi.registeredAmount,'0.00');
});
test('unbalanced or invalid journals and missing/duplicate headers suppress registered totals with diagnostics',()=>{
 const cases=[run(rows.slice(1)),run([...rows,row('services','oops',9)]),run(rows,{headers:{rows:[],complete:true}}),run(rows,{headers:{rows:[...headersOf(rows),headersOf(rows)[0]],complete:true}}),run(rows,{headers:{rows:headersOf(rows).map(r=>({...r,cau_contabile:'PG'})),complete:true}}),run(rows,{headers:{rows:[...headersOf(rows),{data_registr:'20260102',progressivo:99,cau_contabile:'PG'}],complete:true}})];
 for(const r of cases){assert.equal(r.recordedCoverageComplete,false);assert.equal(r.ricavi.registeredAmount,null);assert.equal(r.registeredOperatingDifference.amount,null);assert.equal(r.reconciliation.journalBalanceAndHeaderCoverage,false);}
 assert.equal(run(rows.slice(1)).ricavi.observedClassifiedSubtotal,null);
});
test('missing and duplicate account assignments never become patrimonial exclusions or complete classifications',()=>{
 for(const c of [chart.filter(a=>a.codice!=='bank'),[...chart,chart[0]]]){const r=run(rows,{chart:{rows:c,complete:true}});assert.equal(r.recordedCoverageComplete,false);assert.equal(r.ricavi.registeredAmount,null);}
});
test('period filtering uses registration date with inclusive endpoints, no document-date allocations',()=>{
 const r=run([...rows,row('sales',-50,9,'FE','20261031'),row('bank',50,9,'FE','20261031'),row('sales',-99,10,'FE','20261101'),row('bank',99,10,'FE','20261101')]);assert.equal(r.ricavi.registeredAmount,'150.000001');assert.equal(r.coverage.outsidePeriodRows,2);
});
test('partial sources suppress zeros and totals, but preserve explicit observed partial subtotals',()=>{
 const r=run(rows,{journal:{rows,complete:false}});assert.equal(r.ricavi.registeredAmount,null);assert.equal(r.ricavi.observedClassifiedSubtotal,'100.000001');assert.equal(r.coverage.cursorsExhausted,false);
 const empty=run([]);assert.equal(empty.ricavi.registeredAmount,null);assert.equal(empty.registeredOperatingDifference.amount,null);
});
const help=Object.keys({'/conti':1,'/prima-nota':1,'/prima-nota/righe':1}).map(path=>({method:'GET',regexp:'^'+path+'$'}));
function fixture({currentAuth=auth,repeat=false,providerError=false,company='GRE',official=false,clock=()=>Date.parse('2026-11-08T13:00:00Z')}={}){
 const calls=[];const client={azienda:company,getJson:async path=>{
  calls.push(path);if(path==='/help')return [...help,...(official?[{method:'GET',regexp:'^/bilancio$',descrizione:'Bilancio'}]:[])];
  if(path.startsWith('/conti?'))return {dati:chart};if(path.startsWith('/prima-nota?'))return {dati:headersOf(rows)};
  if(providerError)throw Error('private provider secret');
  if(repeat)return {dati:rows,next:'repeat+cursor'};
  if(!path.includes('next='))return {dati:rows.slice(0,2),next:'opaque+cursor'};
  return {dati:rows.slice(2)};
 }};
 return {calls,tool:mexalIncomeStatementTools(currentAuth,{clientForYear:()=>client,now:clock}).MEXAL_CONTO_ECONOMICO_READ};
}
test('read-only tool reads live help and all official cursors, exposes provenance and explicit initial period',async()=>{
 const f=fixture(),r=await f.tool.execute({});assert.equal(r.readOnly,true);assert.equal(r.saved,false);assert.equal(r.period.from,'2026-01-01');assert.equal(r.period.to,'2026-10-31');assert.equal(r.ricavi.registeredAmount,'100.000001');assert.equal(r.currency.code,null);assert.equal(r.officialEndpoint.available,false);assert.equal(r.sources.length,3);assert.equal(r.sources[1].pages,2);assert(f.calls.some(p=>p.includes('next=opaque%2Bcursor')));assert(f.calls.every(p=>p==='/help'||p.includes('fields=')));
});
test('future official endpoint is detected but never invoked without a verified period/schema adapter',async()=>{
 const f=fixture({official:true}),r=await f.tool.execute({});assert.equal(r.officialEndpoint.available,true);assert.equal(r.officialEndpoint.used,false);assert(!f.calls.some(p=>p.startsWith('/bilancio')));assert.equal(r.EBIT.amount,null);
});
test('repeated pages, upstream errors, budget exhaustion and missing endpoints cannot attest completion',async()=>{
 for(const opts of [{repeat:true},{providerError:true}]){const r=await fixture(opts).tool.execute({});assert.equal(r.recordedCoverageComplete,false);assert.equal(r.ricavi.registeredAmount,null);assert(!JSON.stringify(r).includes('private provider'));}
 for(const capabilities of [[],help.map(h=>({...h,pattern:h.regexp}))]){
  const sources=[];await collectIncomeSource({getJson:async()=>({dati:[]})},'/conti',{capabilities,sources,now:()=>2,started:0,deadlineMs:1});assert.equal(sources[0].complete,false);
 }
});
test('unsafe payload, malformed collection and repeated cursors are explicit failures or partial coverage',async()=>{
 const caps=help.map(h=>({...h,pattern:h.regexp}));
 for(const payload of [{dati:'bad'},{dati:[],next:false}]){const sources=[];const r=await collectIncomeSource({getJson:async()=>payload},'/conti',{capabilities:caps,sources,now:()=>0,started:0,deadlineMs:1});assert.equal(r.complete,false);}
 await assert.rejects(collectIncomeSource({getJson:async()=>({password:'hidden',dati:[]})},'/conti',{capabilities:caps,sources:[],now:()=>0,started:0,deadlineMs:1}));
});
test('personal authorization is checked before any provider access; revoked admins and own/team scopes denied',async()=>{
 assert.deepEqual(mexalIncomeStatementTools({...auth,capabilities:{internal_data:false}}),{});assert.deepEqual(mexalIncomeStatementTools({...auth,profile:{ruoli:{}}}),{});
 for(const mode of ['team','propri',false,'error']){const currentAuth={...auth,scoped:{rpc:async n=>({data:n==='workspace_user_is_admin'?mode!==false:{mode},error:mode==='error'?{}:null})}},f=fixture({currentAuth});await assert.rejects(f.tool.execute({}));assert.equal(f.calls.length,0);}
});
test('invalid/future/cross-year periods, unsafe parameters and company mismatch are rejected',async()=>{
 const f=fixture();for(const input of [{year:2027},{from:'2026-02-30'},{to:'2026-12-31'},{from:'2027-01-01'},{from:'2026-10-31',to:'2026-01-01'},{year:2026,from:'2025-01-01'},{periodOverride:true},{snapshot:'secret'},{offset:1}])await assert.rejects(f.tool.execute(input));
 await assert.rejects(fixture({company:'OTHER'}).tool.execute({}));
 const past=await f.tool.execute({year:2025,from:'2025-01-01',to:'2025-10-31'});assert.equal(past.year,2025);
});
test('detail snapshot binds period/principal/source and paginates without truncated totals',()=>{
 const first=run(rows,{input:{limit:1}});assert.equal(first.accounts.length,1);assert.equal(first.pagination.nextOffset,1);
 const second=run(rows,{input:{offset:1,limit:1,snapshot:first.pagination.snapshot}});assert.equal(second.accounts.length,1);assert.notEqual(first.accounts[0].code,second.accounts[0].code);assert.deepEqual(first.ricavi,second.ricavi);
 for(const change of [{principalId:'other'},{period:{from:'2026-03-01',to:'2026-10-31'}},{sources:[{snapshot:'changed'}]}])assert.throws(()=>run(rows,{...change,input:{offset:1,snapshot:first.pagination.snapshot}}),e=>e.status===409);
});
test('dynamic connector advertises and invokes personal read-only tool; status lists it; revocation blocks call',async()=>{
 const {tool}=fixture();let exposed=true;const calls=[];
 const bridge=createBridge({request:async body=>{calls.push(body);return body.action==='catalog'?{tools:exposed?[{name:'MEXAL_CONTO_ECONOMICO_READ',effect:'read',inputSchema:tool.inputSchema,description:tool.description}]:[]}:{result:{readOnly:true}};}});
 assert((await bridge.tools()).some(t=>t.name==='MEXAL_CONTO_ECONOMICO_READ'));await bridge.call('MEXAL_CONTO_ECONOMICO_READ',{});assert.equal(calls.at(-1).name,'MEXAL_CONTO_ECONOMICO_READ');assert.deepEqual(onlineStatus({tools:[{name:'MEXAL_CONTO_ECONOMICO_READ'}]}).financialTools,['MEXAL_CONTO_ECONOMICO_READ']);exposed=false;await assert.rejects(bridge.call('MEXAL_CONTO_ECONOMICO_READ',{}));
});
