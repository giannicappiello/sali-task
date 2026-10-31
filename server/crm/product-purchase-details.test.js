
import test from 'node:test';
import assert from 'node:assert/strict';
import {productCustomers,productDocuments} from '../../src/modules/crm/productPurchaseDetails.js';
import {queryDetailRows} from '../../src/modules/crm/crmDetailQuery.js';
const lines=[
 {line_id:'1',document_id:'f1',document_number:'FT 1/1',document_date:'2026-10-01',customer_code:'a',customer_name:'Rossi',quantity:2,net_amount:20},
 {line_id:'2',document_id:'f1',document_number:'FT 1/1',document_date:'2026-10-01',customer_code:'a',customer_name:'Rossi',quantity:3,net_amount:30},
 {line_id:'3',document_id:'f2',document_number:'FT 1/2',document_date:'2026-10-02',customer_code:'a',customer_name:'Rossi',quantity:4,net_amount:40},
 {line_id:'4',document_id:'f3',document_number:'FT 1/3',document_date:'2026-10-03',customer_code:'b',customer_name:'Bianchi',quantity:1,net_amount:10}
];
test('document count is distinct and repeated product lines combine within each document',()=>{
 const documents=productDocuments(lines);
 assert.equal(documents.length,3);
 assert.equal(documents.find(r=>r.id==='f1').quantity,5);
 assert.equal(documents.find(r=>r.id==='f1').amount,50);
 assert.equal(documents[0].id,'f3');
 assert.equal(lines[0].quantity,2);
});
test('customer totals and nested document quantities reconcile with product totals',()=>{
 const customers=productCustomers(lines);
 const rossi=customers.find(r=>r.customer_code==='a');
 assert.equal(rossi.quantity,9);assert.equal(rossi.documents.length,2);
 assert.equal(rossi.documents.reduce((s,r)=>s+r.quantity,0),rossi.quantity);
 assert.equal(customers.reduce((s,r)=>s+r.quantity,0),10);
 assert.equal(customers.reduce((s,r)=>s+r.amount,0),100);
});
test('same-name customers keep separate identities, missing names use account fallback, unknown amounts stay partial',()=>{
 const customers=productCustomers([{...lines[0],customer_name:'Mario'}, {...lines[3],customer_name:'Mario',net_amount:null}]);
 assert.equal(customers.length,2);assert.equal(customers.find(r=>r.customer_code==='b').unknownAmount,true);
 const fallback=productCustomers([{document_id:'f',quantity:1,net_amount:0}],{code:'z',name:'Cliente sito'})[0];
 assert.equal(fallback.customer_name,'Cliente sito');assert.equal(fallback.customer_code,'z');
 assert.equal(fallback.documents[0].amount,0);assert.equal(fallback.unknownAmount,false);
});
test('aggregation and sorting use all loaded rows before pagination, including negative credit quantities',()=>{
 const rows=Array.from({length:601},(_,i)=>({...lines[0],line_id:String(i),document_id:'f'+i,quantity:i===600?-1:1}));
 const customers=productCustomers(rows);
 assert.equal(customers[0].quantity,599);assert.equal(customers[0].documents.length,601);
 const sorted=queryDetailRows(customers[0].documents,[{key:'quantity',value:r=>r.quantity,sortValue:r=>r.quantity}],'',{}, {key:'quantity',direction:'asc'});
 assert.equal(sorted[0].quantity,-1);
});
