import test from'node:test';import assert from'node:assert/strict';
import{sameFirstDecimal,withinTenCents,moneyVerification}from'../src/money-policy.mjs';
import{prepareOrder}from'../src/order.mjs';import{exampleOrder,options}from'./fixtures.mjs';
test('confronto al primo decimale: nove centesimi ammessi, un centesimo sul confine respinto',()=>{
 for(const [a,b]of[[6203,6204],[6200,6209],[6209,6200],[0,9]])assert.equal(sameFirstDecimal(a,b),true);
 for(const [a,b]of[[6209,6210],[6200,6210],[6199,6200],[6203,6303],[-1,0],[NaN,0],[Infinity,0],[1.5,1]])assert.equal(sameFirstDecimal(a,b),false);
});
test('IVA riepilogativa con un centesimo diverso passa senza modificare righe o prezzi',()=>{
 const source=exampleOrder(),original=prepareOrder(source,options);source.total_tax='28.88';
 const plan=prepareOrder(source,options);assert.deepEqual(plan.lines,original.lines);assert.equal(plan.totalCents,16010);assert.deepEqual(plan.sourceTotals,{totalCents:16010,taxCents:2888});
 const proof=moneyVerification(plan,16011,2888);assert.equal(proof.totalDifferenceCents,1);assert.equal(proof.sourceTotalCents,16010);
 assert.equal(moneyVerification(plan,16020,2890).policy,'ten_cents');
 assert.throws(()=>moneyVerification(plan,16021,2888),/10 centesimi/);assert.throws(()=>moneyVerification(plan,16011,2899),/10 centesimi/);
});
test('header accettato entro dieci centesimi e hash degli ordini esatti preservato',()=>{
 const source=exampleOrder(),original=prepareOrder(source,options);assert.equal(Object.hasOwn(original,'sourceTotals'),false);
 source.total='160.19';assert.equal(prepareOrder(source,options).sourceTotals.totalCents,16019);
 source.total='160.20';assert.equal(prepareOrder(source,options).sourceTotals.totalCents,16020);
 source.total='160.21';assert.throws(()=>prepareOrder(source,options),/10 centesimi/);
 source.total='160.10';source.total_tax='28.98';assert.throws(()=>prepareOrder(source,options),/10 centesimi/);
});
test('tolleranza assoluta inclusiva e simmetrica, senza sommare tolleranze tra sorgente e righe',()=>{
 for(const [a,b]of[[2259,2260],[100,110],[110,100],[0,10]])assert.equal(withinTenCents(a,b),true);
 for(const [a,b]of[[100,111],[111,100],[-1,0],[NaN,0],[Infinity,0],[1.5,1]])assert.equal(withinTenCents(a,b),false);
 assert.throws(()=>moneyVerification({totalCents:100,taxCents:20,sourceTotals:{totalCents:110,taxCents:20}},120,20),/10 centesimi/);
});
