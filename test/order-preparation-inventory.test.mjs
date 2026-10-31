import test from 'node:test';
import assert from 'node:assert/strict';
import {lotInventoryForWarehouses} from '../server/order-preparation-mexal.js';
import {allocateFifo,distributeLots} from '../shared/orderPreparation.js';

test('FIFO explicitly reads each source warehouse; omitted coordinate would read warehouse 1', async () => {
  const scopes=[];
  const factory=({warehouse})=>{
    scopes.push(warehouse);
    assert.ok([4,5].includes(warehouse));
    return {async getJson(path){
      if(path.startsWith('/progressivi-articoli'))return {
        cod_articolo:[[1,'IT0082'],[2,'IT0418']],
        id_magazzino:[[1,warehouse],[2,warehouse]],
        id_lotto:[[1,warehouse*100+1],[2,warehouse*100+2]],
        qta_inventario:[[1,warehouse===5?378:1],[2,warehouse===5?3976:0]],
        qta_carico:[],qta_scarico:[],
      };
      const id=Number(path.split('/').at(-1));
      return {id,cod_articolo:id%100===1?'IT0082':'IT0418',stato:'C',caricato:'S',data_carico:'20260101',data_validita:'20271231',cod_ute_lotto:'L'+id};
    }};
  };
  const lines=[{code:'IT0082',warehouse:5,quantity:24,position:1,lotRequired:true},{code:'IT0082',warehouse:4,quantity:1,position:2,lotRequired:true},{code:'IT0418',warehouse:5,quantity:13,position:3,lotRequired:true}];
  const inventory=await lotInventoryForWarehouses(factory,lines);
  assert.deepEqual(scopes,[5,4]);
  assert.deepEqual(inventory.lines.map(l=>[l.code,l.warehouse,l.physical]),[['IT0082',5,378],['IT0082',4,1],['IT0418',5,3976]]);
  const allocated=allocateFifo(inventory.lines,inventory.lots,[],'20261031');
  assert.equal(allocated.reduce((n,l)=>n+l.quantity,0),38);
  assert.ok(allocated.every(l=>l.lotId===l.warehouse*100+(l.code==='IT0082'?1:2)));
});

test('FIFO never borrows stock from another warehouse', async()=>{
  const inventory=await lotInventoryForWarehouses(({warehouse})=>({async getJson(){return {cod_articolo:[[1,'IT0082']],id_magazzino:[[1,warehouse===5?1:5]],id_lotto:[[1,101]],qta_inventario:[[1,1000]],qta_carico:[],qta_scarico:[]};}}),[{code:'IT0082',warehouse:5,quantity:24,lotRequired:true}]);
  assert.equal(inventory.lines[0].physical,0);
  assert.deepEqual(inventory.lots,[]);
  assert.throws(()=>allocateFifo(inventory.lines,inventory.lots,[],'20261031'),/insufficienti/);
});


test('FIFO exhausts the oldest lot then takes only the remaining quantity from the newer lot, preserving box contents',()=>{
  const allocations=allocateFifo([{code:'IT0082',position:1,warehouse:5,quantity:24,lotRequired:true}],
    [{code:'IT0082',warehouse:5,lotId:10005,lotCode:'100701063',quantity:376,entryDate:'20260727'},
     {code:'IT0082',warehouse:5,lotId:9209,lotCode:'100701062',quantity:2,entryDate:'20260413'}],[],'20261031');
  assert.deepEqual(allocations.map(a=>[a.lotCode,a.quantity]),[['100701062',2],['100701063',22]]);
  const contents=distributeLots({packages:[{id:'box1'},{id:'box2'}],scans:[{packageId:'box1',code:'IT0082',quantity:12},{packageId:'box2',code:'IT0082',quantity:12}]},allocations);
  assert.deepEqual(contents.map(c=>[c.packageId,c.lotCode,c.quantity]),[['box1','100701062',2],['box1','100701063',10],['box2','100701063',12]]);
});
