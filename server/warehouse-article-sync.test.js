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
 return {db,mexalFactory,calls,writes};
}

test('one material reads Mexal directly in warehouses 1 and 8 without accessing MES',async()=>{
 const f=fixture();const mes={syncInventoryArticle(){assert.fail('MES must remain independent');}};
 const result=await syncWarehouseArticle(f.db,{articleCode:' mp2317 ',warehouseNumber:8},{mexalFactory:f.mexalFactory,mes});
 assert.equal(f.calls.length,2);assert.deepEqual(f.calls.map(x=>x.warehouse).sort(),[1,8]);
 assert.ok(f.calls.every(x=>x.path.includes('MP2317')));assert.equal(f.writes.length,1);
 const args=f.writes[0].args;assert.equal(args.p_article_code,'MP2317');assert.equal(args.p_rows.length,2);
 assert.ok(args.p_rows.every(x=>x.article_code==='MP2317'&&x.source_payload.source_system==='Mexal'));
 assert.equal(args.p_rows.find(x=>x.warehouse_number===8).on_hand,32000);
 assert.equal(args.p_rows.find(x=>x.warehouse_number===8).available,31900);
 assert.match(result.message,/direttamente da Mexal in Workspace/);
});
test('a failed warehouse read preserves both previous balances without any database write',async()=>{
 const f=fixture({failWarehouse:8});await assert.rejects(syncWarehouseArticle(f.db,{articleCode:'MP2317',warehouseNumber:1},{mexalFactory:f.mexalFactory}),/Mexal non disponibile/);
 assert.equal(f.writes.length,0);
});
test('wrong article or missing progressive is rejected before replacing stock',async()=>{
 for(const config of [{wrongArticle:true},{missingStock:true}]){
  const f=fixture(config);await assert.rejects(syncWarehouseArticle(f.db,{articleCode:'MP2317',warehouseNumber:8},{mexalFactory:f.mexalFactory}));assert.equal(f.writes.length,0);
 }
});
test('database failure never reports synchronization completed',async()=>{
 const f=fixture({writeError:{message:'stock database unavailable'}});
 await assert.rejects(syncWarehouseArticle(f.db,{articleCode:'MP2317',warehouseNumber:8},{mexalFactory:f.mexalFactory}),/stock database unavailable/);
});
test('old or mismatched saved stock is not reported as a completed refresh',async()=>{
 const f=fixture({wrongSavedStock:true});await assert.rejects(syncWarehouseArticle(f.db,{articleCode:'MP2317',warehouseNumber:8},{mexalFactory:f.mexalFactory}),/salvataggio Workspace non confermato/);
});
test('newer independent Mexal refresh is retained and reported precisely',async()=>{
 const f=fixture({superseded:true});const result=await syncWarehouseArticle(f.db,{articleCode:'MP2317',warehouseNumber:8},{mexalFactory:f.mexalFactory});
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
 await syncWarehouseArticle(db,{articleCode:'IT001',warehouseNumber:5},{mexalFactory});
 assert.equal(writes.length,4);assert.equal(writes[0].rows[0].warehouse_number,5);assert.equal(writes[0].rows[0].on_hand,105);
 assert.equal(writes[2].values.giacenza,105);assert.deepEqual(writes[2].filters,[['codice_articolo','IT001']]);
});
