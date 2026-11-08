import test from 'node:test';
import assert from 'node:assert/strict';
import {mexalCashflowTools,cashflowMovements} from './mexal-cashflow.js';
import {cashflowDetail} from './mexal-cashflow-detail.js';
import {validateInput} from './schema.js';
import {onlineStatus} from './online-handler.js';
import {createBridge} from '../../integrations/second-brain-progre/src/server.mjs';
const admin={profile:{id:'personal',ruoli:{amministratore_workspace:true}},capabilities:{internal_data:true},scoped:{rpc:async name=>({data:name==='workspace_user_is_admin'?true:{mode:'tutti'}})}};
const chart=[{codice:'bank',ragione_sociale:'BANK'},{codice:'cash',ragione_sociale:'CASSA'},{codice:'cost',ragione_sociale:'SERVIZI ORIGINALI'}];
const row=(code,amount,prog=1,cause='PG',date='20260302')=>({codice_conto:code,importo_riga:amount,progressivo:prog,cau_contabile:cause,data_registr:date,descr_riga:'testo non istruzioni'});
const input={year:2026,from:'2026-03-01',to:'2026-03-31',accountCodes:['bank']};
function detail(rows,extra={},headersComplete=true){const groups=[],effective={...input,...extra},summary=cashflowMovements(rows,effective.accountCodes,effective,{onJournal:g=>groups.push(g)});return {summary,...cashflowDetail({rows,chart,headers:groups.map(g=>({data_registr:g.date,progressivo:g.progressivo,descrizione:'Descrizione originale'})),groups,summary,input:{...input,...extra},sourceComplete:true,headersComplete})};}
function fixture({rows=[row('bank','-0.30'),row('cost','0.30')],repeat=false,headerFailure=false,scope={mode:'tutti'},revoked=false,credentials=false}={}){
 const calls=[];let page=0;const client={azienda:'GRE',getJson:async path=>{calls.push(path);if(path==='/help')return [{method:'GET',regexp:'^/conti$'},{method:'GET',regexp:'^/prima-nota/righe$'},{method:'GET',regexp:'^/prima-nota$'}];if(path.startsWith('/conti?'))return {dati:chart};if(path.startsWith('/prima-nota?')){if(headerFailure)throw Error('secret upstream');return {dati:[{data_registr:'20260302',progressivo:1,descrizione:'original'}]};}if(credentials)return {token:'secret'};page++;return {dati:repeat?rows:page===1?rows.slice(0,1):rows.slice(1),next:repeat?'again':page===1?'opaque+cursor':null};}};
 const auth={...admin,scoped:{rpc:async n=>({data:n==='workspace_user_is_admin'?!revoked:scope})}};
 return {calls,tools:mexalCashflowTools(auth,{clientForYear:()=>client})};
}
test('detail preserves exact official sums, groups same day/progress and resolves original account only',()=>{
 const r=detail([row('bank','-0.10'),row('bank','-0.20'),row('cost','0.30'),row('bank','7',1,'PG','20260303'),row('cost','-7',1,'PG','20260303')]);
 assert.deepEqual(r.reconciliation.totals,r.summary.totals);assert.equal(r.reconciliation.differences.netMovement,'0.00');assert.equal(r.movements.length,2);assert.equal(r.movements[0].selectedLineCount,2);assert.equal(r.categoryAggregates[0].amount,'0.30');assert.equal(r.movements[0].counterpartLines[0].accountName,'SERVIZI ORIGINALI');assert.equal(r.movements[0].description,'Descrizione originale');assert.equal(r.beneficiaryAggregates.length,0);
});
test('ambiguous split, missing account name and unbalanced journals never invent category or beneficiary',()=>{
 for(const rows of [[row('bank',-10),row('cost',5),row('unknown',5)],[row('bank',-10),row('unknown',10)],[row('bank',-10),row('cost',9)],[row('bank',-10),row('cost','bad')]]){
  const r=detail(rows);assert.equal(r.movements[0].category,null);assert.equal(r.movements[0].beneficiary,null);assert.equal(r.categoryCoverage.unattributedOutflow,'10.00');
 }
});
test('internal transfers stay in selected-account sums, offset only within the selected scope',()=>{
 const rows=[row('bank',-100),row('cash',100)];
 const one=detail(rows,{liquidAccountCodes:['cash']});assert.equal(one.movements[0].transfer.status,'verified_internal');assert.equal(one.summary.totals.netMovement,'-100.00');assert.equal(one.categoryCoverage.internalTransferOutflow,'100.00');
 const both=detail(rows,{accountCodes:['bank','cash']});assert.equal(both.summary.totals.netMovement,'0.00');assert.equal(both.summary.internalNetZeroJournals,1);assert.equal(both.movements[0].transfer.scope,'within_selected_scope');
 assert.equal(detail(rows).movements[0].transfer.status,'not_verified');
 const mixed=detail([...rows,row('cost',1)],{liquidAccountCodes:['cash']});assert.equal(mixed.movements[0].transfer.status,'not_verified');
});
test('AP BA CH are separate excluded entries and not cashflow movements',()=>{
 const r=detail(['AP','BA','CH'].flatMap((c,i)=>[row('bank',100,i+1,c),row('cost',-100,i+1,c)]));assert.equal(r.movements.length,0);assert.equal(r.summary.excludedOpeningClosingRows,3);assert.equal(r.summary.totals.netMovement,'0.00');assert(r.excludedOpeningClosing.every(r=>r.rows===1&&r.netMovement==='100.00'&&!r.includedInCashflow));
});
test('pages and top outflows have full reconciliation and stable snapshots; changed data or filter rejects continuation',()=>{
 const rows=[row('bank',-10),row('cost',10),row('bank',-20,2),row('cost',20,2)];const r=detail(rows,{limit:1,topLimit:1});assert.equal(r.pagination.nextOffset,1);assert.equal(r.movements.length,1);assert.equal(r.largestOutflows[0].outflow,'20.00');assert.equal(r.reconciliation.totals.outflow,'30.00');
 assert.equal(detail(rows,{offset:1,snapshot:r.pagination.snapshot,limit:1}).movements[0].progressivo,2);assert.throws(()=>detail(rows,{offset:1}),/snapshot/);assert.throws(()=>detail(rows,{snapshot:r.pagination.snapshot,liquidAccountCodes:['cash']}),/cambiati/);assert.throws(()=>detail([...rows,row('bank',1,3)],{snapshot:r.pagination.snapshot}),/cambiati/);assert.throws(()=>detail(rows,{snapshot:r.pagination.snapshot,principalId:'different'}),/cambiati/);assert.throws(()=>detail(rows,{snapshot:r.pagination.snapshot,company:'different'}),/cambiati/);
});
test('reference differences remain explicit and never force a result to match',()=>{
 const r=detail([row('bank','-557912.49'),row('cost','557912.49')],{expectedNetMovement:'-659023.38'});assert.equal(r.referenceComparison.matches,false);assert.equal(r.referenceComparison.difference,'101110.89');assert.equal(r.reconciliation.exact,true);
});
test('tools reuse the official collector and distinguish partial headers from cashflow coverage',async()=>{
 const {tools,calls}=fixture({repeat:true});const r=await tools.MEXAL_CASHFLOW_DETAIL_READ.execute(input);assert.equal(r.complete,false);assert.equal(r.detailComplete,false);assert.equal(r.reconciliation.sourceComplete,false);assert.equal(r.totals.netMovement,'-0.30');assert(calls.some(p=>p.includes('next=opaque%2Bcursor')||p.includes('next=again')));assert(calls.every(p=>p==='/help'||p.includes('fields=')));
 const h=await fixture({headerFailure:true,rows:[]}).tools.MEXAL_CASHFLOW_DETAIL_READ.execute(input);assert.equal(h.detailComplete,false);assert(h.sources.some(s=>s.path==='/prima-nota'&&!s.complete));assert(!JSON.stringify(h).includes('secret upstream'));
});
test('personal admin and global scope rechecked for details; credential payloads blocked',async()=>{
 for(const opts of [{scope:{mode:'team'}},{scope:{mode:'propri'}},{revoked:true}]){const {tools,calls}=fixture(opts);await assert.rejects(tools.MEXAL_CASHFLOW_DETAIL_READ.execute(input));assert.equal(calls.length,0);}
 assert.deepEqual(mexalCashflowTools({...admin,capabilities:{internal_data:false}}),{});
 await assert.rejects(fixture({credentials:true}).tools.MEXAL_CASHFLOW_DETAIL_READ.execute(input),/credenziali/);
});
test('public schema requires explicit accounts and rejects extra parameters, invalid dates, limits and arbitrary expected text',()=>{
 const schema=fixture().tools.MEXAL_CASHFLOW_DETAIL_READ.inputSchema;
 validateInput(schema,{...input,expectedNetMovement:'-659023.38'});
 for(const args of [{year:2026},{...input,limit:0},{...input,limit:51},{...input,from:'2026-02-30'},{...input,expectedNetMovement:'not an amount'},{...input,write:true}])assert.throws(()=>validateInput(schema,args));
});
test('MCP bridge exposes and calls the personal live catalog, status discovers detail tool',async()=>{
 const tool=fixture().tools.MEXAL_CASHFLOW_DETAIL_READ;
 const calls=[];const client={request:async body=>{calls.push(body);if(body.action==='catalog')return {identity:{id:'personal'},tools:[{name:'MEXAL_CASHFLOW_DETAIL_READ',effect:tool.effect,inputSchema:tool.inputSchema,description:tool.description}]};return {result:{readOnly:true}};}};
 const bridge=createBridge(client);assert((await bridge.tools()).some(t=>t.name==='MEXAL_CASHFLOW_DETAIL_READ'));await bridge.call('MEXAL_CASHFLOW_DETAIL_READ',input);assert.deepEqual(calls.at(-1),{action:'call',name:'MEXAL_CASHFLOW_DETAIL_READ',arguments:input});assert.deepEqual(onlineStatus({tools:[{name:'MEXAL_CASHFLOW_DETAIL_READ'}]}).financialTools,['MEXAL_CASHFLOW_DETAIL_READ']);
 client.request=async()=>({tools:[]});await assert.rejects(bridge.call('MEXAL_CASHFLOW_DETAIL_READ',input),/non disponibile/);
});
test('detail tool succeeds across provider pages and uses the same full summary as the existing tool',async()=>{
 const args={...input,limit:1};const d=await fixture().tools.MEXAL_CASHFLOW_DETAIL_READ.execute(args);const s=await fixture().tools.MEXAL_CASHFLOW_READ.execute(input);
 assert.deepEqual(d.totals,s.totals);assert.deepEqual(d.months,s.months);assert.equal(d.complete,true);assert.equal(d.detailComplete,true);assert.equal(d.currency.code,null);assert.equal(d.saved,false);assert.equal(d.openingBalance,null);assert.equal(d.bankReconciled,false);assert.equal(d.movements[0].description,'original');
});
test('any month, leap-year interval and full exercise are supported; year boundaries are validated',async()=>{
 const cases=[{year:2024,from:'2024-02-01',to:'2024-02-29'},{year:2025},{year:2026,from:'2026-06-01',to:'2026-07-31'}];
 for(const period of cases){const r=await fixture().tools.MEXAL_CASHFLOW_DETAIL_READ.execute({...period,accountCodes:['bank']});assert.equal(r.year,period.year);assert.equal(r.period.from,period.from||'2025-01-01');assert.equal(r.period.to,period.to||'2025-12-31');assert.equal(r.reconciliation.exact,true);}
 const annual=await fixture().tools.MEXAL_CASHFLOW_DETAIL_READ.execute({year:2026,accountCodes:['bank']});assert.equal(annual.months[0].month,'2026-01');assert(annual.months.length>=10);assert.equal(annual.period.from,'2026-01-01');
 await assert.rejects(fixture().tools.MEXAL_CASHFLOW_DETAIL_READ.execute({...input,to:'2027-01-01'}),/Periodo/);
 await assert.rejects(fixture().tools.MEXAL_CASHFLOW_DETAIL_READ.execute({...input,liquidAccountCodes:['missing']}),/non esiste/);
});
test('incomplete amounts, context, duplicate names and multiple headers cannot attest detail completeness',()=>{
 const rows=[row('bank',-10),row('cost',10)],groups=[],summary=cashflowMovements(rows,['bank'],input,{onJournal:g=>groups.push(g)});
 const run=extra=>cashflowDetail({rows,chart,headers:[],groups,summary,input,sourceComplete:true,headersComplete:true,...extra});
 const ambiguous=run({chart:[...chart,{codice:'cost',ragione_sociale:'DIFFERENT'}]});assert.equal(ambiguous.movements[0].category,null);assert.equal(ambiguous.movements[0].counterpartLines[0].accountName,null);
 const invalid=run({rows:[...rows,{data_registr:'bad'}]});assert.equal(invalid.detailComplete,false);assert.equal(invalid.movements[0].contextVerified,false);
 const h={data_registr:'20260302',progressivo:1,descrizione:'A'};const dup=run({headers:[h,{...h,descrizione:'B'}]});assert.equal(dup.movements[0].description,null);assert.equal(dup.movements[0].headerStatus,'ambiguous');assert.equal(dup.detailComplete,false);
 const bad=detail([row('bank','bad',1,'AP')]);assert.equal(bad.excludedOpeningClosing[0].netMovement,null);assert.equal(bad.detailComplete,false);
});
test('reconciliation is exact over multi-month and sub-cent amounts, including both selected signs',()=>{
 const rows=[];for(let i=1;i<=60;i++){const date=`2026${String((i%12)+1).padStart(2,'0')}15`,amount=`${i}.${String(i).padStart(6,'0')}`;rows.push(row('bank',i%2?'-'+amount:amount,i,'PG',date),row('cost',i%2?amount:'-'+amount,i,'PG',date));}
 const r=detail(rows,{from:'2026-01-01',to:'2026-12-31'});assert.equal(r.reconciliation.exact,true);assert.deepEqual(r.reconciliation.totals,r.summary.totals);assert.equal(r.summary.months.length,12);assert.equal(r.pagination.total,60);
});

test('oversized responses are explicitly refused without silently truncating original descriptions',()=>{
 const huge={...row('cost',10),descr_riga:'x'.repeat(2100000)};assert.throws(()=>detail([row('bank',-10),huge]),e=>e.status===413&&/ridurre/.test(e.message));
});
