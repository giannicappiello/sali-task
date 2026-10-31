import test from 'node:test';
import assert from 'node:assert/strict';
import {packingWeights,productWeightGrams,tareWeightKg} from '../shared/preparationWeights.js';
import {deliveryDestination} from '../server/order-preparation-mexal.js';

test('product weights and tare validate units and precision without deriving grams from ml',()=>{
  for(const value of ['',0,-1,'bad','250 ml','1.0001',Infinity])assert.equal(productWeightGrams(value),null);
  assert.equal(productWeightGrams('250,125'),250.125);assert.equal(tareWeightKg('0'),0);
  assert.throws(()=>tareWeightKg('-1'),/Kg/);assert.equal(tareWeightKg(''),null);
});
test('net and gross weights count mixed products and FIFO splits once and one tare per box and pallet',()=>{
  const result=packingWeights({totalPallets:1,totalPackages:2,totalPieces:5,pallets:[{id:'p1',number:1}],packages:[{number:1,palletId:'p1',contents:[{code:'IT1',lotCode:'OLD',quantity:1},{code:'IT1',lotCode:'NEW',quantity:2}]},{number:2,palletId:'p1',contents:[{code:'IT2',quantity:2}]}]},[{code:'IT1',unitWeightGrams:250.125},{code:'IT2',unitWeightGrams:100}],{box_tare_kg:0.3,pallet_tare_kg:20});
  assert.equal(result.packages[0].netWeightKg,0.750375);assert.equal(result.packages[0].grossWeightKg,1.050375);
  assert.equal(result.pallets[0].netWeightKg,0.950375);assert.equal(result.pallets[0].grossWeightKg,21.550375);
  assert.equal(result.weightTotals.grossWeightKg,21.550375);
  assert.throws(()=>packingWeights(result,[],{box_tare_kg:0.3,pallet_tare_kg:20}),/mancante/);
  assert.throws(()=>packingWeights(result,[{code:'IT1',unitWeightGrams:250},{code:'IT2',unitWeightGrams:100}],{}),/Configura/);
});
test('packing list resolves the actual shipping address ID, verifies customer and keeps postal details',async()=>{
  const client={async getJson(path){assert.equal(path,'/indirizzi-spedizione/501');return {id:'501',cod_conto:'501.00487',descrizione:'Kosmo Sas',indirizzo:'Via de Spuches, 40',cap:'90044',localita:'CARINI',provincia:'PA',cod_paese:'IT'};}};
  const address=await deliveryDestination(client,{id_ind_sped:[[1,'0']],cod_anag_sped:[[1,'501']]},'501.00487');
  assert.equal(address.address,'Via de Spuches, 40');assert.equal(address.postalCode,'90044');assert.equal(address.province,'PA');
  await assert.rejects(deliveryDestination(client,{cod_anag_sped:[[1,'501']]},'501.00001'),/coerente/);
  const main=await deliveryDestination(client,{},'501.00001',{ragione_sociale:'Cliente',indirizzo:'Via reale 1',cap:'12345',localita:'Roma'});
  assert.equal(main.address,'Via reale 1');
});
