import test from 'node:test';
import assert from 'node:assert/strict';
import {cashAmount,cashflowMovements,mexalCashflowTools} from './mexal-cashflow.js';
import {onlineStatus} from './online-handler.js';
const admin={profile:{id:'admin',ruoli:{amministratore_workspace:true}},capabilities:{internal_data:true},scoped:{rpc:async name=>({data:name==='workspace_user_is_admin'?true:{mode:'tutti'}})}};
const help=[{method:'GET',regexp:'^/conti$'},{method:'GET',regexp:'^/prima-nota/righe$'}];
const line=(account,amount,progressivo=1,cause='PG',date='20260102')=>({codice_conto:account,importo_riga:amount,progressivo,cau_contabile:cause,data_registr:date});
test('cash flow preserves decimal amounts and offsets internal transfers by official journal identity',()=>{
 assert.equal(cashAmount('0.000001'),1n);assert.throws(()=>cashAmount('1.0000001'));assert.throws(()=>cashAmount(null));
 const rows=[line('bank',100),line('cash',-100),line('bank',0.1,2),line('bank',0.2,3),line('bank',-0.3,4),line('bank',-12.3456,5),line('bank',1000,6,'AP'),line('bank',50,7,'BA'),line('bank',999,8,'CH'),line('sales',50000,9),line('bank',99,10,'PG','20251231')];
 const r=cashflowMovements(rows,['bank','cash'],{from:'2026-01-01',to:'2026-02-28'});
 assert.equal(r.totals.netMovement,'-12.3456');assert.equal(r.totals.inflow,'0.30');assert.equal(r.totals.outflow,'12.6456');assert.equal(r.internalNetZeroJournals,1);assert.equal(r.excludedOpeningClosingRows,3);assert.equal(r.outsidePeriodRows,1);assert.equal(r.months[1].netMovement,'0.00');
});
test('bad amounts, dates and absent registration identifiers produce explicit incompleteness',()=>{
 const r=cashflowMovements([line('bank','not money'),line('bank',1,0),line('bank',1,1,'PG','20260230'),line('bank',2,2)],['bank'],{from:'2026-01-01',to:'2026-12-31'});
 assert.equal(r.invalidRows,3);assert.equal(r.selectedRows,1);assert.equal(r.totals.netMovement,'2.00');
});
function fixture({repeat=false,failJournal=false}={}){
 const calls=[];const client={azienda:'GRE',anno:'2026',getJson:async path=>{calls.push(path);if(path==='/help')return help;if(path.startsWith('/conti?'))return {dati:[{codice:'bank',ragione_sociale:'Banca corrente',bil_34dir_ue_d:'CIV1'},{codice:'cash',ragione_sociale:'CASSA',bil_34dir_ue_d:'CIV3'}]};if(failJournal)throw Error('Do not expose provider secret');if(!path.includes('next='))return {dati:[line('bank',100)],next:'opaque+cursor'};return repeat?{dati:[line('bank',100)],next:'different'}:{dati:[line('bank',-40,2)]};}};
 return {calls,tools:mexalCashflowTools(admin,{clientForYear:()=>client,now:()=>Date.parse('2026-11-08T10:00:00Z')})};
}
test('account selection is a live read without querying journals or writing memory',async()=>{
 const {calls,tools}=fixture(),r=await tools.MEXAL_CASHFLOW_READ.execute({year:2026});assert.equal(r.requiresAccountSelection,true);assert.equal(r.candidates.length,2);assert.equal(r.saved,false);assert.equal(calls.length,2);assert.equal(r.period.to,'2026-11-08');
});
test('cash flow follows official cursors, excludes future periods, and distinguishes net movement from balances',async()=>{
 const {tools,calls}=fixture(),r=await tools.MEXAL_CASHFLOW_READ.execute({year:2026,accountCodes:['bank']});assert.equal(r.complete,true);assert.equal(r.totals.netMovement,'60.00');assert.equal(r.openingBalance,null);assert.equal(r.closingBalance,null);assert.equal(r.bankReconciled,false);assert.equal(r.currency.code,null);assert(calls.at(-1).includes('next=opaque%2Bcursor'));assert(calls.every(p=>p==='/help'||p.includes('fields=')));
 await assert.rejects(tools.MEXAL_CASHFLOW_READ.execute({year:2026,accountCodes:['not-a-current-account']}),/non esiste/);
 await assert.rejects(tools.MEXAL_CASHFLOW_READ.execute({year:2026,from:'2025-01-01'}),/Periodo/);
});
test('repeated pages or upstream failures are partial, never full cash flow or duplicate sums',async()=>{
 const a=await fixture({repeat:true}).tools.MEXAL_CASHFLOW_READ.execute({year:2026,accountCodes:['bank']});assert.equal(a.complete,false);assert.equal(a.totals.netMovement,'100.00');assert.match(a.sources.at(-1).reason,/ripete/);
 const b=await fixture({failJournal:true}).tools.MEXAL_CASHFLOW_READ.execute({year:2026,accountCodes:['bank']});assert.equal(b.complete,false);assert.equal(b.selectedRows,0);assert(!JSON.stringify(b).includes('provider secret'));
});
test('admin revocation and scoped users cannot reach a Mexal client',async()=>{
 assert.deepEqual(mexalCashflowTools({...admin,profile:{ruoli:{}}}),{});
 for(const state of [false,{mode:'team'}]){
  const auth={...admin,scoped:{rpc:async name=>({data:name==='workspace_user_is_admin'?(state===false?false:true):state})}};
  const tool=mexalCashflowTools(auth,{clientForYear:()=>assert.fail('unauthorized connection')}).MEXAL_CASHFLOW_READ;
  await assert.rejects(tool.execute({year:2026}));
 }
});
test('online status advertises only finance tools in this user catalog, without claiming app refresh',()=>{
 const r=onlineStatus({identity:{id:'caller'},tools:[{name:'MEXAL_CASHFLOW_READ'},{name:'MEXAL_FINANCE_READ'},{name:'MEMORY_SAVE'}]});assert.deepEqual(r.financialTools,['MEXAL_CASHFLOW_READ','MEXAL_FINANCE_READ']);assert.equal(r.identity.id,'caller');assert(!r.toolDiscovery.includes('concedere'));
 assert.deepEqual(onlineStatus({tools:[]}).financialTools,[]);
});
