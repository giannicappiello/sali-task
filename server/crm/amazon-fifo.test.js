import test from 'node:test';
import assert from 'node:assert/strict';
import {warehouseLotStock,applyFifoLots,prepareFifoLots} from './amazon-fifo.js';
const payload={data_documento:'20261022',codice_articolo:[[1,'IT1'],[2,'IT1']],quantita:[[1,3],[2,1]],id_magazzino:4};
const articles=new Map([['IT1',{cod_tp_lotto:'aj'}]]);
const lot=(id,date)=>({id,cod_articolo:'IT1',stato:'C',caricato:'S',data_carico:date});
test('stock excludes every warehouse except 4 and computes available lots',()=>{
 assert.deepEqual(warehouseLotStock({cod_articolo:[[1,'IT1'],[2,'IT1']],id_magazzino:[[1,4],[2,1]],id_lotto:[[1,9],[2,8]],qta_inventario:[[1,2]],qta_carico:[[1,5]],qta_scarico:[[1,4]]}),[{code:'IT1',lotId:9,quantity:3}]);
});
test('FIFO splits lots by load date, shares stock across repeated lines and never uses automatic -2',()=>{
 const p=applyFifoLots(payload,articles,[lot(2,'20261020'),lot(1,'20261001')],[{code:'IT1',lotId:1,quantity:2},{code:'IT1',lotId:2,quantity:5}]);
 assert.deepEqual(p.id_lotto,[[1,1],[2,2],[3,2]]);assert.deepEqual(p.qta_lotto,[[1,2],[2,1],[3,1]]);
 assert.deepEqual(p.pos_righe_lotto,[[1,1],[2,3]]);assert.deepEqual(p.nr_righe_lotto,[[1,2],[2,1]]);
});
test('insufficient, future, expired or unloaded stock blocks COX',()=>{
 for(const l of [lot(1,'20261023'),{...lot(1,'20261001'),data_validita:'20261021'},{...lot(1,'20261001'),caricato:'N'}]) assert.throws(()=>applyFifoLots(payload,articles,[l],[{code:'IT1',lotId:1,quantity:10}]),/insufficienti/);
 assert.throws(()=>applyFifoLots(payload,articles,[lot(1,'20261001')],[{code:'IT1',lotId:1,quantity:3}]),/insufficienti/);
});
test('FIFO reads existing lots and stock only',async()=>{
 const calls=[];
 const p=await prepareFifoLots({getJson:async path=>{calls.push(path);return {cod_articolo:[[1,'IT1']],id_magazzino:[[1,4]],id_lotto:[[1,1]],qta_carico:[[1,4]]};},postJson:async path=>{calls.push(path);assert.match(path,/lotti\/ricerca/);return {dati:[lot(1,'20261001')]};}},payload,articles);
 assert.equal(p.id_lotto[0][1],1);assert.equal(calls.length,2);
});
