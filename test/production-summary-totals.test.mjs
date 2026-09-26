import test from 'node:test';
import assert from 'node:assert/strict';
import {summaryGroups,total,pairedDifference,conclusionDate,splitSaliDiIschia} from '../src/features/production-costs/summary-totals.js';
const rows=[{planned:120,actual:100,oct:140,invoice:130},{planned:60,actual:50,oct:null,invoice:55},{planned:90,actual:80,oct:95,invoice:null},{planned:40,actual:30,oct:45,octPartial:true,invoice:35}];
test('invoice comparisons exclude missing invoices and partial OC from their own bases',()=>{const g=summaryGroups(rows);assert.equal(total(g.invoiced,'invoice'),220);assert.equal(pairedDifference(g.invoiced,'invoice','actual'),40);assert.equal(pairedDifference(g.invoiceOc,'invoice','oct'),-10);assert.equal(g.uninvoiced.length,1);assert.equal(g.invoiced.length-g.invoiceOc.length,2);});
test('OC comparisons use only comparable rows while costs retain all rows',()=>{const g=summaryGroups(rows);assert.equal(g.matched.length,2);assert.equal(g.excluded.length,2);assert.equal(pairedDifference(g.matched,'oct','actual'),55);assert.equal(total(rows,'actual'),260);assert.equal(pairedDifference(rows,'planned','actual'),50);});
test('zero invoices are valid and absent amounts never become zero',()=>{const g=summaryGroups([{invoice:0,oct:0,actual:0}]);assert.equal(g.invoiced.length,1);assert.equal(pairedDifference(g.invoiceOc,'invoice','oct'),0);assert.equal(total([],'invoice'),null);assert.equal(pairedDifference([{invoice:10,actual:null}],'invoice','actual'),null);});

test('partial OC still has a provisional row difference but is excluded from totals',()=>{const row={oct:2340,actual:3252.22,planned:3565.39,octPartial:true};assert.equal(pairedDifference([row],'oct','actual'),2340-3252.22);assert.equal(summaryGroups([row]).matched.length,0);});
test('conclusion is latest actual finish, with no guessed date for missing ends',()=>{assert.equal(conclusionDate([{state:'Terminato',end:'2026-09-18T10:00:00'},{state:'Terminato',end:'2026-09-19T11:00:00'}]),'2026-09-19T11:00:00');assert.equal(conclusionDate([{state:'Terminato',end:null}]),null);assert.equal(conclusionDate([]),null);});

test('Sali di Ischia has a separate non-overlapping scope based on customer identity',()=>{
 const rows=[{customerCode:'501.00995',actual:100},{customerCode:'OTHER',articleName:'SALI DI ISCHIA',actual:20},{customerName:'Sali di Ischia',actual:30},{customerCode:'OTHER',customerName:'SALI DI ISCHIA',actual:40}];
 const {ordinary,sali}=splitSaliDiIschia(rows);assert.equal(sali.length,2);assert.equal(total(sali,'actual'),130);assert.equal(total(ordinary,'actual'),60);assert.equal(ordinary.some(r=>sali.includes(r)),false);
});
