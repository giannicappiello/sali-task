import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryMovement,inventoryValuation} from './mexal-inventory-model.js';
const period={year:2026,from:'2026-09-01',to:'2026-09-30'};
const article=(code='IT1',cost=2)=>({codice:code,descrizione:code,um_principale:'PZ',costo_ult:cost});
const native=(code='IT1',warehouse=1,initial=10,carico=20,scarico=5)=>({cod_articolo:code,id_magazzino:warehouse,um_principale:'PZ',qta_inventario:initial,qta_carico:carico,qta_scarico:scarico});
const line=(sigla,number,quantity,date='20260910',extra={})=>({sigla,serie:1,numero:number,cod_conto:'501.00152',id_riga:1,id_rif_testata:1,codice_articolo:'IT1',id_causale_riga:0,tp_um_articolo:'1',quantita:quantity,id_mag_da_riga:1,id_mag_a_riga:0,data_documento:date,sigla_doc_orig:sigla,data_doc_orig:date,...extra});
const base=()=>({articles:[article()],progressives:[native()],movements:[line('CL',1,20),line('FT',1,5,'20261010',{sigla_doc_orig:'BC',data_doc_orig:'20260920'})],period});
test('historical quantities use original delivery date and reconcile current loads and unloads separately',()=>{
 const r=inventoryValuation(base());assert.equal(r.complete,true);assert.equal(r.reconciliation.quantitiesReconciled,true);assert.equal(r.valuation.opening,'20.00');assert.equal(r.valuation.closing,'50.00');assert.equal(r.valuation.change,'30.00');assert.equal(r.details[0].closingQuantity,'25.000000');
});
test('first and last dates are inclusive; invoices do not delay the original stock movement',()=>{
 const b=base();b.movements=[line('CL',1,20,'20260901'),line('FT',1,5,'20261010',{sigla_doc_orig:'BC',data_doc_orig:'20260930'})];const r=inventoryValuation(b);assert.equal(r.valuation.opening,'60.00');assert.equal(r.valuation.closing,'50.00');
});
test('signed returns and value-only rows preserve the exact physical balance',()=>{
 const b=base();b.movements.push(line('NC',1,2),line('BS',1,4,'20260910',{tp_um_articolo:'V'}));b.progressives=[native('IT1',1,10,20,3)];let r=inventoryValuation(b);assert.equal(r.complete,true);assert.equal(r.valuation.closing,'54.00');assert.equal(r.reconciliation.valueOnlyRows,1);
 b.movements.push(line('SL',2,-1));b.progressives=[native('IT1',1,10,20,2)];r=inventoryValuation(b);assert.equal(r.valuation.closing,'56.00');
});
test('internal transfers change warehouse loads but cancel when warehouses are grouped',()=>{
 const b=base();b.movements.push(line('BD',1,7,'20260915',{id_mag_a_riga:5}));b.progressives=[native('IT1',1,10,13,5),native('IT1',5,0,7,0)];const r=inventoryValuation(b);assert.equal(r.complete,true);assert.equal(r.valuation.change,'30.00');assert.equal(r.reconciliation.positionsCompared,2);
});
test('aggregate warehouses and lots before excluding negative article balances',()=>{
 const b={articles:[article()],progressives:[native('IT1',1,10,0,0),native('IT1',5,-4,0,0)],movements:[],period};const r=inventoryValuation(b);assert.equal(r.complete,true);assert.equal(r.valuation.opening,'12.00');assert.equal(r.coverage.opening.negativeArticles,0);
 const n=inventoryValuation({...b,progressives:[native('IT1',1,-2,0,0)]});assert.equal(n.valuation.opening,'0.00');assert.equal(n.coverage.opening.negativeArticles,1);
});
test('missing or zero costs are reported, never silently valued at zero',()=>{
 for(const cost of [undefined,0,-1]){const b=base();b.articles=[{...article(),costo_ult:cost}];const r=inventoryValuation(b);assert.equal(r.complete,false);assert.equal(r.valuation.change,null);assert.equal(r.coverage.opening.missingCosts.length,1);}
});
test('unknown document effects, ambiguous dates, alternative units and unequal progressives suppress totals',()=>{
 const cases=[line('OTHER',9,1),line('BS',9,1,'20260230'),line('BS',9,1,'20260910',{tp_um_articolo:'2'}),line('BS',9,1,'20260910',{id_causale_riga:5}),line('FT',9,1,'20260910',{sigla_doc_orig:'XX',data_doc_orig:'20260901'})];
 for(const row of cases){const b=base();b.movements.push(row);const r=inventoryValuation(b);assert.equal(r.complete,false);assert.equal(r.valuation.opening,null);assert(r.reconciliation.unresolved.length>0);}
 const b=base();b.progressives[0].qta_carico=21;const r=inventoryValuation(b);assert.equal(r.valuation.change,null);assert.equal(r.reconciliation.differences[0].caricoDifference,'-1.000000');
});
test('subheader identifiers preserve separate transformed lines and true duplicates block completion',()=>{
 const b=base();const row={...b.movements[0],id_rif_testata:2};b.movements.push(row);b.progressives[0].qta_carico=40;assert.equal(inventoryValuation(b).complete,true);
 b.movements.push(row);assert.equal(inventoryValuation(b).complete,false);
});
test('rounding uses decimal cents per article and initial inventory is not counted twice',()=>{
 const b={articles:[article('IT1',0.005),article('IT2',0.005)],progressives:[native('IT1',1,1,0,0),native('IT2',1,1,0,0)],movements:[line('IN',1,999)],period};const r=inventoryValuation(b);assert.equal(r.complete,true);assert.equal(r.valuation.opening,'0.02');assert.equal(r.reconciliation.inventoryAdjustmentRows,1);
});
