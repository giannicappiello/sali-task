/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDdt,verifyOrphanDdtForDeletion} from '../server/order-preparation-mexal.js';
import {previewOrphanDdtDeletion,deleteOrphanDdt} from '../server/preparation-ddt-deletion.js';
import {orderRows,initialPacking} from '../shared/orderPreparation.js';
import {preparationDatabase,supabaseAdapter,mexalFixture,event,actor} from './order-preparation-fixture.mjs';
const {PGlite}=await import(process.env.PGLITE_MODULE);
async function fixture() {
  const sql=await preparationDatabase(PGlite),db=supabaseAdapter(sql),raw=mexalFixture().raw;
  const source={series:1,number:900,year:2026,reference:'OC+1+900',date:raw.data_documento,customerCode:raw.cod_conto,lines:orderRows(raw).map(line=>({...line,lotRequired:true}))};
  const row={id:event(),source,source_raw:raw,source_hash:'source',status:'uncertain',version:7,export_token:event(),state:initialPacking()};
  row.export_payload=buildDdt(row,{source,raw},source.lines.map((line,i)=>({...line,lotId:51+i,quantity:line.quantity})),{ddt_series:1},'20261102');
  let document={...structuredClone(row.export_payload),numero:123,data_ult_mod:'20261102 140539',sigla_doc_orig:[[1,'BC']],serie_doc_orig:[[1,1]],numero_doc_orig:[[1,123]],sigla_ordine:[],serie_ordine:[],numero_ordine:[]};
  await sql.query('insert into warehouse_order_preparations(id,source_key,source,source_raw,source_hash,state,status,version,export_token,export_payload,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)',[row.id,row.id,source,raw,row.source_hash,row.state,row.status,row.version,row.export_token,row.export_payload,actor]);
  let deletes=0,failRead=false;
  const client={getJson:async path=>{
    if(path.startsWith('/documenti/ordini-clienti/')) return structuredClone(raw);
    if(failRead){failRead=false;throw Object.assign(Error('Readback unavailable'),{status:503});}
    if(!document)throw Object.assign(Error('Document not found'),{status:404});return structuredClone(document);
  },deleteJson:async path=>{assert.equal(path,'/documenti/movimenti-magazzino/'+encodeURIComponent(`BC+1+123+${raw.cod_conto}`));deletes++;document=null;throw Error('DELETE response lost');}};
  return {sql,db,row,raw,client,get document(){return document;},get deletes(){return deletes;},failRead(){failRead=true;},findExisting:async()=>document};
}
test('orphan deletion preserves scans, archives the document and resets only after readback proves absence',async()=>{
  const f=await fixture();try {
    const original=structuredClone(f.document),state=structuredClone(f.row.state);
    const plan=await previewOrphanDdtDeletion({...f,actual:original});
    const args={...f,actual:original,actor,hash:plan.hash,reference:plan.reference};
    await assert.rejects(deleteOrphanDdt({...args,hash:'stale'}),/cambiati/);assert.equal(f.deletes,0);
    f.failRead();await assert.rejects(deleteOrphanDdt(args),/Readback unavailable/);assert.equal(f.deletes,1);
    assert.equal((await f.sql.query('select status from warehouse_order_preparations')).rows[0].status,'uncertain');
    const restored=await deleteOrphanDdt({...args,actual:null});
    assert.equal(f.deletes,1);assert.equal(restored.status,'draft');assert.equal(restored.export_token,null);assert.equal(restored.export_payload,null);assert.equal(restored.verification,null);assert.deepEqual(restored.state,state);
    await deleteOrphanDdt({...args,actual:null});assert.equal(f.deletes,1);
    const audit=(await f.sql.query("select event_type,payload from warehouse_preparation_events order by id")).rows;
    assert.deepEqual(audit.map(e=>e.event_type),['orphan_ddt_delete_requested','orphan_ddt_deleted']);assert.deepEqual(audit[0].payload.document,original);assert.equal(audit[1].payload.documentAbsent,true);
    await assert.rejects(f.sql.exec('delete from warehouse_preparation_events'),/immutabile/);
  }finally{await f.sql.close();}
});
test('deletion rejects native links, changed quantities or lots, source changes and archived dispatch artifacts',async()=>{
  const f=await fixture();try{
    const doc=f.document;
    assert.throws(()=>verifyOrphanDdtForDeletion({...doc,sigla_ordine:[[1,'OC']]},f.row,f.raw),/già collegata/);
    const changed=structuredClone(doc);changed.quantita[0][1]++;
    assert.throws(()=>verifyOrphanDdtForDeletion(changed,f.row,f.raw),/Quantità/);
    const lots=structuredClone(doc);lots.id_lotto[0][1]++;
    assert.throws(()=>verifyOrphanDdtForDeletion(lots,f.row,f.raw),/Lotti|lotto|lotti/);
    assert.throws(()=>verifyOrphanDdtForDeletion(doc,f.row,{...f.raw,data_ult_mod:'changed'}),/OCM modificato/);
    await f.sql.query("insert into warehouse_preparation_documents(preparation_id,kind,filename,sha256,base64,snapshot) values($1,'bcf','doc.pdf',$2,'QQ==','{}')",[f.row.id,'a'.repeat(64)]);
    await assert.rejects(previewOrphanDdtDeletion({...f,actual:doc}),/già registrati/);assert.equal(f.deletes,0);
  }finally{await f.sql.close();}
});
