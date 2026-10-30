import test from 'node:test';
import assert from 'node:assert/strict';
import { showCartonViolations, showOrderQuantityError, isOrderQuantityError } from '../src/modules/orders/services/orderQuantityDialog.js';
test('gli errori quantità aprono un popup centrato e deduplicano blur e conferma',async()=>{
 let release;const calls=[];
 const alert=(...args)=>{calls.push(args);return new Promise(resolve=>{release=resolve;});};
 const first=showCartonViolations([{message:'A: Multipli di 6. Quantità inserita: 5.'}],{alert});
 const second=showOrderQuantityError('Stesso errore',{alert});
 assert.equal(first,second);assert.equal(calls.length,1);
 assert.match(calls[0][0],/A: Multipli di 6/);
 assert.deepEqual(calls[0][1],{title:'Quantità non consentita',variant:'danger',viewportCentered:true});
 release(true);await first;
 await showOrderQuantityError('Quantità maggiore di zero',{alert:()=>{calls.push('new');}});
 assert.equal(calls.length,2);
 assert.equal(isOrderQuantityError(new Error('A: Multipli di 6. Quantità inserita: 5.')),true);
 assert.equal(isOrderQuantityError(new Error('Errore rete')),false);
});
