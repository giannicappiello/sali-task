import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCartonRule, validateOrderCartons, cartonQuantityAllowed, cartonRuleLabel } from '../src/modules/orders/services/orderCartonRules.js';
const rule=(tipo='multiple_of',valore=6,extra={})=>({id:'r',tipo,valore,prodotti:['A'],modulo_ordini:'prof',attiva:true,...extra});
const rows=(...quantities)=>quantities.map(quantita=>({codice_articolo:'A',quantita}));
test('multipli interi, decimali e valori grandi senza tolleranze che ammettano falsi multipli',()=>{
 for(const [q,v,result] of [[6,6,true],[12,6,true],[5,6,false],[0.3,0.1,true],[0.35,0.1,false],[1000000000.001,1000000000,false]]) assert.equal(cartonQuantityAllowed(q,rule('multiple_of',v)),result);
});
test('limiti stretti e inclusivi ed esatta quantità',()=>{
 for(const [type,low,equal,high] of [['less_than',true,false,false],['less_or_equal',true,true,false],['greater_than',false,false,true],['greater_or_equal',false,true,true],['equal',false,true,false]]) {
  assert.deepEqual([5,6,7].map(q=>cartonQuantityAllowed(q,rule(type))),[low,equal,high]);
 }
});
test('somma righe duplicate, combina regole e ignora descrizioni/spedizione',()=>{
 const rules=[rule(),rule('less_than',24,{id:'max'})];
 assert.equal(validateOrderCartons(rows(2,4),rules,'prof').length,0);
 assert.equal(validateOrderCartons(rows(12,12),rules,'prof')[0].ruleId,'max');
 assert.equal(validateOrderCartons([{codice_articolo:'A',quantita:1,riga_spedizione:true},{codice_articolo:'A',quantita:1,riga_descrittiva:true}],rules,'prof').length,0);
});
test('isola PR e PH, regole inattive e articoli non selezionati',()=>{
 assert.equal(validateOrderCartons(rows(5),[rule()],'ph').length,0);
 assert.equal(validateOrderCartons(rows(5),[rule('multiple_of',6,{modulo_ordini:'ph'})],'ph').length,1);
 assert.equal(validateOrderCartons(rows(5),[rule()],'private').length,0);
 assert.equal(validateOrderCartons(rows(5),[rule('multiple_of',6,{attiva:false})],'prof').length,0);
 assert.equal(validateOrderCartons([{codice_articolo:'B',quantita:5}],[rule()],'prof').length,0);
});
test('messaggio articolo e normalizzazione delle referenze',()=>{
 const normalized=normalizeCartonRule(rule('multiple_of','6',{prodotti:[' a ','A','b'],messaggio:' Solo cartoni interi '}),'prof');
 assert.deepEqual(normalized.prodotti,['A','B']);
 const errors=validateOrderCartons([{codice_articolo:' a ',quantita:5}],[normalized],'prof');
 assert.match(errors[0].message,/A: Solo cartoni interi.*Multipli di 6/);
 assert.equal(cartonRuleLabel(normalized),'Multipli di 6');
});
test('rifiuta configurazioni senza referenze, valori errati e quantità non positive',()=>{
 for(const value of [0,-1,NaN,Infinity,1000000001,1.0000005])assert.throws(()=>normalizeCartonRule(rule('multiple_of',value),'prof'));
 assert.throws(()=>normalizeCartonRule(rule('multiple_of',6,{prodotti:[]}),'prof'));
 for(const q of [0,-1,NaN,Infinity])assert.equal(cartonQuantityAllowed(q,rule()),false);
});
