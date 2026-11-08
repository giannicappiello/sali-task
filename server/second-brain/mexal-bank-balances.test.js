import test from 'node:test';
import assert from 'node:assert/strict';
import {bankBalances,mexalBankBalanceTools} from './mexal-bank-balances.js';
import {createBridge} from '../../integrations/second-brain-progre/src/server.mjs';
import {onlineStatus} from './online-handler.js';
const auth={profile:{ruoli:{amministratore_workspace:true}},capabilities:{internal_data:true},scoped:{rpc:async n=>({data:n==='workspace_user_is_admin'?true:{mode:'tutti'}})}};
const row=(code,amount,cause='PG',date='20260102',progressivo=1)=>({codice_conto:code,importo_riga:amount,cau_contabile:cause,data_registr:date,progressivo});
const chart=[{codice:'bank',ragione_sociale:'Bank',bil_34dir_ue_d:'CIV1',fido_scoperto:0},{codice:'other',bil_34dir_ue_d:'CIV1'}];
const opening=[row('bank','12.123456','AP','20260101'),row('capital','-12.123456','AP','20260101')];
const run=(rows,complete=true)=>bankBalances({rows,chart,codes:['bank'],year:2026,asOf:'2026-03-31',complete,readAt:'2026-11-08T12:00:00Z',sources:[]});
test('absent AP never invents zero or derives a balance from movements',()=>{
 const a=run([row('bank',100)]).accounts[0];assert.equal(a.openingBalance.amount,null);assert.equal(a.closingBalance.amount,null);assert.equal(a.movements.netMovement,'100.00');assert.equal(a.completeness.closing,false);
 assert.equal(a.availableBalance,null);assert.equal(a.bankReconciledBalance,null);assert.equal(a.exposure,null);assert.equal(a.creditFacilitiesAtDate,null);assert.equal(a.configuredFacilities.fido_scoperto.amount,'0.00');assert.equal(a.configuredFacilities.fido_scoperto.validAt,null);
});
test('balanced AP provides recorded opening and exact shared-engine movements, without rounding or bank claims',()=>{
 const a=run([...opening,row('bank','0.000001','PG','20260102',2),row('bank','-0.10','PG','20260202',3),row('bank',999,'PG','20260401',4)]).accounts[0];
 assert.equal(a.openingBalance.amount,'12.123456');assert.equal(a.movements.netMovement,'-0.099999');assert.equal(a.closingBalance.amount,'12.023457');assert.equal(a.completeness.closing,true);assert.equal(a.bankReconciled,false);assert.equal(a.currency.code,null);assert.equal(a.currency.valueDate,null);
});
test('partial pagination, malformed AP, different fiscal dates, and unbalanced journals block opening',()=>{
 for(const [rows,complete] of [[opening,false],[[row('bank',10,'AP','20260101')],true],[[row('bank',1,'AP','20260201')],true],[[row('bank','oops','AP','20260101')],true],[[row('bank',0,'AP','20260101',0)],true]]){
  const a=run(rows,complete).accounts[0];assert.equal(a.openingBalance.amount,null);assert.equal(a.closingBalance.amount,null);
 }
});
test('attested explicit zero AP remains zero; BA/CH never disappear into a false final balance',()=>{
 const a=run([row('bank',0,'AP','20260101')]).accounts[0];assert.equal(a.openingBalance.amount,'0.00');
 for(const cause of ['BA','CH']){const b=run([...opening,row('bank',100,cause,'20260102',2)]).accounts[0];assert.equal(b.openingBalance.amount,'12.123456');assert.equal(b.closingBalance.amount,null);assert.equal(b.excludedAccountingRows,1);}
 const b=run([...opening,row('bank','invalid')]).accounts[0];assert.equal(b.closingBalance.amount,null);
});
function fixture(overrides={}){
 const calls=[];const client={azienda:'GRE',getJson:async path=>{calls.push(path);if(path==='/help')return [{method:'GET',regexp:'^/conti$'},{method:'GET',regexp:'^/prima-nota/righe$'}];if(path.startsWith('/conti'))return {dati:chart};if(overrides.repeat)return {dati:[row('bank',1)],next:'repeat'};return {dati:[...opening,row('bank',10)]};}};
 const current=overrides.auth||auth;
 return {calls,tool:mexalBankBalanceTools(current,{clientForYear:()=>client,now:()=>Date.parse('2026-11-08T12:00:00Z')}).MEXAL_BANK_BALANCES_READ};
}
test('tool validates date/account and consumes existing read-only collector with repeated-cursor protection',async()=>{
 const f=fixture(),r=await f.tool.execute({year:2026,accountCodes:['bank']});assert.equal(r.period.to,'2026-11-08');assert.equal(r.accounts[0].closingBalance.amount,'22.123456');assert(f.calls.every(p=>p==='/help'||p.includes('fields=')));
 for(const input of [{year:2026,asOf:'2026-12-31',accountCodes:['bank']},{year:2026,asOf:'2025-12-31',accountCodes:['bank']},{year:2026,accountCodes:['missing']},{year:2026,accountCodes:[]}])await assert.rejects(f.tool.execute(input));
 const p=await fixture({repeat:true}).tool.execute({year:2026,accountCodes:['bank']});assert.equal(p.complete,false);assert.equal(p.accounts[0].closingBalance.amount,null);assert.match(p.sources.at(-1).reason,/ripete/);
});
test('personal admin is checked live before accessing any client; scope/team/revocation never broadened',async()=>{
 assert.deepEqual(mexalBankBalanceTools({...auth,capabilities:{internal_data:false}}),{});
 assert.deepEqual(mexalBankBalanceTools({...auth,profile:{ruoli:{}}}),{});
 for(const scope of [false,'team','propri']){const f=fixture({auth:{...auth,scoped:{rpc:async n=>({data:n==='workspace_user_is_admin'?scope!==false:{mode:scope}})}}});await assert.rejects(f.tool.execute({year:2026,accountCodes:['bank']}));assert.equal(f.calls.length,0);}
});
test('personal dynamic MCP catalog exposes and invokes tool without static permission bypass',async()=>{
 const {tool}=fixture();const calls=[];let exposed=true;
 const bridge=createBridge({request:async body=>{calls.push(body);return body.action==='catalog'?{tools:exposed?[{name:'MEXAL_BANK_BALANCES_READ',effect:'read',description:tool.description,inputSchema:tool.inputSchema}]:[]}:{result:{readOnly:true}};}});
 assert((await bridge.tools()).some(t=>t.name==='MEXAL_BANK_BALANCES_READ'));
 await bridge.call('MEXAL_BANK_BALANCES_READ',{year:2026,accountCodes:['bank']});assert.equal(calls.at(-1).name,'MEXAL_BANK_BALANCES_READ');
 assert.deepEqual(onlineStatus({tools:[{name:'MEXAL_BANK_BALANCES_READ'}]}).financialTools,['MEXAL_BANK_BALANCES_READ']);
 exposed=false;await assert.rejects(bridge.call('MEXAL_BANK_BALANCES_READ',{year:2026,accountCodes:['bank']}),/non disponibile/);
});
