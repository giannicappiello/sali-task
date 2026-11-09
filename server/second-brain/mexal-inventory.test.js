import test from 'node:test';
import assert from 'node:assert/strict';
import {inventorySource,inventoryPeriod,progressiveRows,mexalInventoryTools} from './mexal-inventory.js';
const admin={profile:{id:'personal',ruoli:{amministratore_workspace:true}},capabilities:{internal_data:true},scoped:{rpc:async n=>({data:n==='workspace_user_is_admin'?true:{mode:'tutti'}})}};
test('requires live admin verification before contacting Mexal',async()=>{
 assert.deepEqual(mexalInventoryTools({...admin,capabilities:{internal_data:false}}),{});
 const t=mexalInventoryTools({...admin,scoped:{rpc:async()=>({data:false})}},{clientForYear:()=>{assert.fail('not authorized');}}).MEXAL_INVENTORY_READ;
 await assert.rejects(t.execute({from:'2026-09-01',to:'2026-09-30'}));
});
test('validates actual dates and Rome future cutoff',()=>{
 assert.deepEqual(inventoryPeriod({from:'2026-09-01',to:'2026-09-30'},Date.parse('2026-11-09T12:00Z')),{year:2026,from:'2026-09-01',to:'2026-09-30'});
 for(const input of [{from:'2026-02-30',to:'2026-03-01'},{from:'2026-09-30',to:'2026-09-01'},{from:'2026-09-01',to:'2026-12-01'},{year:2025,from:'2026-09-01',to:'2026-09-30'}])assert.throws(()=>inventoryPeriod(input,Date.parse('2026-11-09T12:00Z')));
});
test('search preserves signed quantities, sends only read-search payload and exhausts cursors',async()=>{
 const calls=[];const client={postJson:async(path,body)=>{calls.push({path,body});return path.includes('next=')?{dati:[{quantita:2}]}:{dati:[{quantita:-5}],next:'opaque+token'};}};
 const filter={campo:'codice_articolo',condizione:'inizia_per',valore:'IT'};
 const r=await inventorySource(client,'/documenti/movimenti-magazzino/righe/ricerca',{filter});
 assert.equal(r.rows[0].quantita,-5);assert.equal(r.rows.length,2);assert.equal(r.complete,true);assert(calls[1].path.includes('next=opaque%2Btoken'));assert.deepEqual(calls[0].body,{filtri:[filter]});
});
test('repeated cursors, missing row format and credential fields fail closed',async()=>{
 for(const result of [{dati:[{}],next:'repeat'},{unknown:[]},{dati:[{password:'do-not-return'}]}])await assert.rejects(inventorySource({getJson:async()=>result},'/test',{maxPages:3}));
});
test('sparse matrices join by index and retain negative lots for aggregation',()=>{
 const r=progressiveRows({num_prog_art:2,cod_articolo:[[3,'IT1'],[9,'IT1']],id_magazzino:[[3,1],[9,1]],um_principale:[[3,'PZ'],[9,'PZ']],qta_inventario:[[3,10],[9,-3]],qta_carico:[],qta_scarico:[[3,2]]});
 assert.equal(r[1].qta_inventario,-3);assert.equal(r.reduce((s,x)=>s+x.qta_inventario+x.qta_carico-x.qta_scarico,0),5);
 assert.throws(()=>progressiveRows({cod_articolo:[]}));
});
function sourceFixture(overrides={}){
 const calls=[];const progressive={num_prog_art:1,cod_articolo:[[7,'IT1']],id_magazzino:[[7,1]],um_principale:[[7,'PZ']],qta_inventario:[[7,10]],qta_carico:[],qta_scarico:[[7,2]]};
 const client={azienda:'GRE',getJson:async p=>{calls.push(['GET',p]);return p==='/help'?[
  {method:'POST',regexp:'^/articoli/ricerca$'},
  {method:'POST',regexp:'^/documenti/movimenti-magazzino/righe/ricerca$'},
  {method:'GET',regexp:'^/progressivi-articoli$'},
  {method:'GET',regexp:'^/dati-generali/valute$'}]:p.startsWith('/dati-generali/valute')?{dati:[{id:1,descrizione:'Euro'}]}:progressive;},postJson:async(p,b)=>{calls.push(['POST',p,b]);return {dati:p.startsWith('/articoli/')?[{codice:'IT1',costo_ult:4}]:[{codice_articolo:'IT1',quantita:-2}]};},...overrides};
 return {calls,tool:mexalInventoryTools(admin,{clientForYear:(_year,warehouse)=>warehouse?{...client,getJson:async p=>{
  if(overrides.getJson)return overrides.getJson(p);
  calls.push(['GET',p,warehouse]);return {...progressive,id_magazzino:[[7,warehouse]]};
 }}:client,now:()=>Date.parse('2026-11-09T12:00Z')}).MEXAL_INVENTORY_READ};
}
test('source reader has no write or arbitrary service operation and never invents valuation',async()=>{
 const f=sourceFixture(),r=await f.tool.execute({from:'2026-09-01',to:'2026-09-30',includeSources:true});
 assert.equal(r.readOnly,true);assert.equal(r.saved,false);assert.equal(r.complete,false);assert.equal(r.valuation.change,null);assert.equal(r.valuation.opening,null);assert.equal(r.valuation.closing,null);
 assert.equal(r.diagnosticSourceRows.movements[0].quantita,-2);assert.equal(r.scope.articlePrefix,'IT');assert.deepEqual(r.scope.warehouses,[1,2,3,4,5,6,7,8,9,10]);
 assert.deepEqual(r.sources.filter(s=>s.warehouse).map(s=>s.warehouse),[1,2,3,4,5,6,7,8,9,10]);
 for(const [method,path,body]of f.calls)if(method==='POST'){assert(path.startsWith('/articoli/ricerca?')||path.startsWith('/documenti/movimenti-magazzino/righe/ricerca?'));assert.equal(body.filtri.length,1);assert.equal(body.filtri[0].valore,'IT');}
});
test('company, live resource contract, ignored filters and incomplete progressives block the result',async()=>{
 for(const override of [{azienda:'OTHER'},{getJson:async()=>[]},{postJson:async()=>({dati:[{codice:'MP1',codice_articolo:'MP1'}]})},{getJson:async p=>p==='/help'?[{method:'POST',regexp:'^/articoli/ricerca$'},{method:'POST',regexp:'^/documenti/movimenti-magazzino/righe/ricerca$'},{method:'GET',regexp:'^/progressivi-articoli$'}]:{cod_articolo:[]}}]){
  await assert.rejects(sourceFixture(override).tool.execute({from:'2026-09-01',to:'2026-09-30'}));
 }
});
