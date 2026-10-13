import test from 'node:test';
import assert from 'node:assert/strict';
import { syncWarehouseArticle } from './warehouse-article-sync.js';

function fixture({wrongArticle=false,missingStock=false,failWarehouse=null,writeError=null,wrongSavedStock=false,superseded=false}={}) {
 const calls=[];const writes=[];let saved;
 const db={
  async rpc(name,args){writes.push({name,args});assert.equal(name,'apply_workspace_mexal_article_stock');
   saved=args.p_rows.map(row=>({...row,on_hand:wrongSavedStock?1:row.on_hand}));
   return {data:{applied:!superseded,superseded},error:writeError};},
  from(table){assert.equal(table,'workspace_warehouse_stock');let fields;
   return {select(value){fields=value;return this;},eq(key,value){assert.equal(key,'article_code');assert.equal(value,'MP2317');return this;},
    async in(key,values){assert.equal(key,'warehouse_number');assert.deepEqual(values,[1,8]);return {data:fields==='warehouse_number,warehouse_name'
     ?[1,8].map(warehouse_number=>({warehouse_number,warehouse_name:`Warehouse ${warehouse_number}`})):saved,error:null};}};},
 };
 const mexalFactory=({warehouse,timeoutMs})=>{assert.equal(timeoutMs,15000);return {async getJson(path){
  calls.push({warehouse,path});if(warehouse===failWarehouse)throw Error('Mexal non disponibile');
  const article={codice:wrongArticle?'MP9999':'MP2317',qta_inventario:warehouse===8?32000:0,qta_carico:0,qta_scarico:0,
   ord_cli_e:100,impegnato:100,um_principale:'KG',costo_ult:1};
  if(missingStock)for(const field of ['qta_inventario','qta_carico','qta_scarico'])delete article[field];
  return {dati:article};}};};
 const mesCalls=[];
 const mes={async syncInventoryArticle(command){mesCalls.push(command);return {result:{success:true,articleCode:command.articleCode,warehouseNumbers:[1,8]}};}};
 return {db,mexalFactory,mes,mesCalls,calls,writes};
}

test('manual article refresh imports Mexal directly and updates the same article in MES',async()=>{
 const f=fixture();const mes=f.mes;
 const result=await syncWarehouseArticle(f.db,{articleCode:' mp2317 ',warehouseNumber:8},{mexalFactory:f.mexalFactory,mes});
 assert.equal(f.calls.length,2);assert.deepEqual(f.calls.map(x=>x.warehouse).sort(),[1,8]);
 assert.ok(f.calls.every(x=>x.path.includes('MP2317')));assert.equal(f.writes.length,1);
 const args=f.writes[0].args;assert.equal(args.p_article_code,'MP2317');assert.equal(args.p_rows.length,2);
 assert.ok(args.p_rows.every(x=>x.article_code==='MP2317'&&x.source_payload.source_system==='Mexal'));
 assert.equal(args.p_rows.find(x=>x.warehouse_number===8).on_hand,32000);
 assert.equal(args.p_rows.find(x=>x.warehouse_number===8).available,31900);
 assert.match(result.message,/Workspace e MES/);
 assert.equal(result.mesUpdated,true);assert.equal(result.workspaceUpdated,true);
 assert.equal(f.mesCalls.length,1);assert.equal(f.mesCalls[0].articleCode,'MP2317');
});
test('a failed warehouse read preserves both previous balances without any database write',async()=>{
 const f=fixture({failWarehouse:8});await assert.rejects(syncWarehouseArticle(f.db,{articleCode:'MP2317',warehouseNumber:1},{mexalFactory:f.mexalFactory,mes:f.mes}),/Mexal non disponibile/);
 assert.equal(f.writes.length,0);assert.equal(f.mesCalls.length,0);
});
test('wrong article or missing progressive is rejected before replacing stock',async()=>{
 for(const config of [{wrongArticle:true},{missingStock:true}]){
  const f=fixture(config);await assert.rejects(syncWarehouseArticle(f.db,{articleCode:'MP2317',warehouseNumber:8},{mexalFactory:f.mexalFactory,mes:f.mes}));assert.equal(f.writes.length,0);
 }
});
test('database failure never reports synchronization completed',async()=>{
 const f=fixture({writeError:{message:'stock database unavailable'}});
 await assert.rejects(syncWarehouseArticle(f.db,{articleCode:'MP2317',warehouseNumber:8},{mexalFactory:f.mexalFactory,mes:f.mes}),/stock database unavailable/);
});
test('old or mismatched saved stock is not reported as a completed refresh',async()=>{
 const f=fixture({wrongSavedStock:true});await assert.rejects(syncWarehouseArticle(f.db,{articleCode:'MP2317',warehouseNumber:8},{mexalFactory:f.mexalFactory,mes:f.mes}),/salvataggio Workspace non confermato/);
});
test('newer independent Mexal refresh is retained and reported precisely',async()=>{
 const f=fixture({superseded:true});const result=await syncWarehouseArticle(f.db,{articleCode:'MP2317',warehouseNumber:8},{mexalFactory:f.mexalFactory,mes:f.mes});
 assert.match(result.message,/più recente/);
});
test('invalid material or warehouse never calls Mexal',async()=>{
 for(const input of [{articleCode:'',warehouseNumber:8},{articleCode:'MP2317',warehouseNumber:0},{articleCode:'MP2317',warehouseNumber:1.5}])
  await assert.rejects(syncWarehouseArticle({},input,{mexalFactory(){assert.fail('unexpected call');}}),/non valido/);
});
test('commercial warehouse and IT availability retain their separate Mexal scope',async()=>{
 const writes=[];
 const db={from(table){
  return {
   async upsert(rows){writes.push({table,rows});return {error:null};},
   select(){return {eq(){return this;},async maybeSingle(){return {data:{warehouse_name:'Commerciale'}};}};},
   update(values){
    const filters=[];
    return {eq(key,value){filters.push([key,value]);return this;},then(resolve){writes.push({table,values,filters});return Promise.resolve({error:null}).then(resolve);}};
   }
  };
 }};
 const mexalFactory=({warehouse})=>{assert.equal(warehouse,5);return {async getJson(){return {dati:{codice:'IT001',qta_inventario:100,qta_carico:10,qta_scarico:5}};}};};
 const mesCalls=[];
 const mes={async syncInventoryArticle(command){mesCalls.push(command);return {result:{success:true,articleCode:'IT001',warehouseNumbers:[1,8]}};}};
 await syncWarehouseArticle(db,{articleCode:'IT001',warehouseNumber:5},{mexalFactory,mes});
 assert.equal(mesCalls.length,1);assert.equal(mesCalls[0].articleCode,'IT001');
 assert.equal(writes.length,4);assert.equal(writes[0].rows[0].warehouse_number,5);assert.equal(writes[0].rows[0].on_hand,105);
 assert.equal(writes[2].values.giacenza,105);assert.deepEqual(writes[2].filters,[['codice_articolo','IT001']]);
});

test('MES failure reports partial success and preserves the Workspace refresh',async()=>{
 const f=fixture();const mes={async syncInventoryArticle(){throw Error('MES non disponibile');}};
 await assert.rejects(syncWarehouseArticle(f.db,{articleCode:'MP2317',warehouseNumber:8},{mexalFactory:f.mexalFactory,mes}),error=>{
  assert.match(error.message,/Workspace aggiornato.*MES non disponibile/);
  assert.equal(error.details.workspaceUpdated,true);assert.equal(error.details.mesUpdated,false);return true;
 });assert.equal(f.writes.length,1);
});
test('MES confirmation must identify the same article and both operational warehouses',async()=>{
 for(const result of [{success:true,articleCode:'MP9999',warehouseNumbers:[1,8]},
  {success:true,articleCode:'MP2317',warehouseNumbers:[1]}, {success:false,articleCode:'MP2317',warehouseNumbers:[1,8]}]){
  const f=fixture();const mes={async syncInventoryArticle(){return {result};}};
  await assert.rejects(syncWarehouseArticle(f.db,{articleCode:'MP2317',warehouseNumber:1},{mexalFactory:f.mexalFactory,mes}),/Conferma.*MES non valida/);
 }
});
