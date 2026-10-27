import test from 'node:test';import assert from 'node:assert/strict';
import {warehouseStock,catalogSnapshot,catalogPatch,runCatalog} from '../src/catalog.mjs';
const stock=(quantity=10)=>({num_prog_art:3,id_magazzino:[[1,5],[2,5],[3,1]],cod_articolo:[[1,'SKU'],[2,'SKU'],[3,'SKU']],um_principale:[[1,'PZ'],[2,'PZ'],[3,'PZ']],qta_inventario:[[1,20],[3,1000]],qta_carico:[[2,quantity]],qta_scarico:[[1,20]],qta_ord_imp:[[1,2]]});
const article={codice:'SKU',prz_listino:[[1,15.68],[3,40.15]]};
const product={id:1,sku:'SKU',type:'simple',regular_price:'10.00',sale_price:'9.00',tax_status:'taxable',tax_class:'',stock_quantity:1,stock_status:'instock',meta_data:[]};
test('somma lotti del solo magazzino 5 e sottrae impegni dalla quantità vendibile',()=>{
 assert.deepEqual(warehouseStock(stock(),'SKU'),{physical:10,committed:2,sellable:8});
});
test('listino 1 copiato come importo IVA inclusa senza moltiplicazioni',()=>{
 assert.equal(catalogSnapshot(article,stock(),'SKU').price,'15.68');
 assert.throws(()=>catalogSnapshot({...article,prz_listino:[[3,40.15]]},stock(),'SKU'),/Prezzo/);
});
test('soglia esatta: 9 non disponibile, 10 e 11 disponibili',()=>{
 for(const qty of [9,10,11])assert.equal(catalogSnapshot(article,stock(qty),'SKU').status,qty<10?'outofstock':'instock');
});
test('progressivi vuoti ammessi solo con quantità zero verificata nel dettaglio articolo',()=>{
 const empty={...article,um_principale:'PZ',qta_inventario:0,qta_carico:0,qta_scarico:0};
 assert.equal(catalogSnapshot(empty,{},'SKU').status,'outofstock');
 assert.throws(()=>catalogSnapshot({...empty,qta_inventario:1},{},'SKU'),/zero verificata/);
});
test('dati incompleti o unità diversa non azzerano lo stock del sito',()=>{
 assert.throws(()=>warehouseStock({...stock(),num_prog_art:4},'SKU'),/incompleti/);
 assert.throws(()=>warehouseStock({...stock(),qta_scarico:undefined},'SKU'),/mancante/);
 assert.throws(()=>warehouseStock({...stock(),um_principale:[[1,'KG'],[2,'PZ'],[3,'PZ']]},'SKU'),/pezzi/);
 assert.throws(()=>warehouseStock({...stock(),qta_carico:[[99,5]]},'SKU'),/senza magazzino/);
});
test('prezzo esatto, nessuna promozione residua e nessun backorder',()=>{
 const snapshot=catalogSnapshot(article,stock(9),'SKU');const patch=catalogPatch(product,snapshot);
 assert.equal(patch.regular_price,'15.68');assert.equal(patch.sale_price,'');assert.equal(patch.stock_status,'outofstock');assert.equal(patch.stock_quantity,7);assert.equal(patch.backorders,'no');
 assert.equal(catalogPatch({...product,...patch},snapshot),null);
});
test('nessuna scrittura senza impostazione prezzi IVA inclusa',async()=>{
 await assert.rejects(runCatalog({woo:{taxSetting:async()=>({value:'no'})},mexal:{},dryRun:false}),/IVA inclusa/);
});
test('anteprima non scrive e riusa letture Mexal tra traduzioni con stesso SKU',async()=>{
 let reads=0;const report=await runCatalog({woo:{taxSetting:async()=>({value:'yes'}),products:async()=>[product,{...product,id:2}]},mexal:{warehouse:5,request:async path=>(reads++,{data:path.endsWith('/progressivi')?stock():article})}});
 assert.equal(reads,2);assert.deepEqual(report.results.map(x=>x.mode),['preview','preview']);
});
test('alias autorizzato condivide il codice Mexal e la lettura con il prodotto base',async()=>{
 let reads=0;const report=await runCatalog({aliases:{'SKU-1':'SKU'},woo:{taxSetting:async()=>({value:'yes'}),products:async()=>[product,{...product,id:2,sku:'SKU-1'}]},mexal:{warehouse:5,request:async path=>(reads++,{data:path.endsWith('/progressivi')?stock(9):article})}});
 assert.equal(reads,2);assert.equal(report.results[1].mexalSku,'SKU');assert.equal(report.results[1].price,'15.68');assert.equal(report.results[1].status,'outofstock');
 assert.throws(()=>catalogSnapshot(article,stock(),'SKU-1'),/diverso/);
});
test('prodotto non acquistabile escluso senza leggere Mexal o modificarlo',async()=>{
 const report=await runCatalog({excludedIds:[1],woo:{taxSetting:async()=>({value:'yes'}),products:async()=>[product]},mexal:{warehouse:5,request:async()=>{throw Error('Non deve essere chiamata');}}});
 assert.equal(report.results[0].mode,'excluded');
});
test('lotto parzialmente salvato: verifica ogni prodotto con GET indipendente anche dopo timeout',async()=>{
 const snapshot=catalogSnapshot(article,stock(),'SKU');let batches=0,backups=0;
 const report=await runCatalog({dryRun:false,beforeWrite:async()=>{backups++;},
 woo:{taxSetting:async()=>({value:'yes'}),connectorStatus:async()=>({catalog_guard_version:1,authenticated_key_id:3}),products:async()=>[product,{...product,id:2}],
 productBatch:async()=>{batches++;throw Error('timeout');},productsByIds:async()=>[{...product,...catalogPatch(product,snapshot)}]},
 mexal:{warehouse:5,request:async path=>({data:path.endsWith('/progressivi')?stock():article})}});
 assert.equal(batches,1);assert.equal(backups,2);assert.equal(report.results[0].mode,'updated');assert.equal(report.results[1].mode,'attention-required');assert.equal(report.results[1].reason,'timeout');
});
test('codici assenti nelle bozze segnalati come non abbinati; un prodotto pubblico richiede attenzione',async()=>{
 const report=await runCatalog({woo:{taxSetting:async()=>({value:'yes'}),products:async()=>[{...product,status:'draft'},{...product,id:2,status:'publish'}]},mexal:{warehouse:5,request:async()=>{throw Error('Lettura API non riuscita (HTTP 404).');}}});
 assert.deepEqual(report.results.map(x=>x.mode),['unmapped','attention-required']);
});
