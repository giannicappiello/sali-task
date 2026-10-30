import test from 'node:test';
import assert from 'node:assert/strict';
import {groupCustomerInvoices} from '../../src/modules/crm/customerInvoices.js';
import {queryDetailRows} from '../../src/modules/crm/crmDetailQuery.js';

test('groups the entire invoice dataset by customer code and preserves credits and document links',()=>{
 const rows=[
 {id:'one',customer_code:'A',customer_name:'Milùet',document_date:'2026-02-28',amount:100,title:'FT 1/242'},
 {id:'two',customer_code:'B',customer_name:'Milùet',document_date:'2026-09-30',amount:200,title:'FT 1/1370'},
 {id:'three',customer_code:'A',customer_name:'Milùet',document_date:'2026-06-30',amount:-20,title:'NC 1/9'},
 {id:'four',customer_code:'A',customer_name:'Milùet',document_date:'2026-09-30',amount:30,title:'FT 1/973'},
 ];
 const groups=groupCustomerInvoices(rows);
 assert.equal(groups.length,2);assert.equal(groups[0].customer_code,'B');
 const customer=groups.find(r=>r.customer_code==='A');
 assert.equal(customer.amount,110);assert.equal(customer.invoice_count,3);assert.equal(customer.document_date,'2026-09-30');
 assert.deepEqual(customer.invoices.map(r=>r.id),['four','three','one']);
 assert.equal(groups.reduce((s,r)=>s+r.amount,0),rows.reduce((s,r)=>s+r.amount,0));
 assert.equal(rows[0].id,'one');
});
test('aggregation includes invoices beyond the first display page and keeps unidentified customers apart',()=>{
 const rows=Array.from({length:60},(_,i)=>({id:String(i),customer_code:i%2?'A':'B',customer_name:'Customer',amount:1}));
 const groups=groupCustomerInvoices(rows);assert.equal(groups.length,2);assert.ok(groups.every(r=>r.invoice_count===30&&r.amount===30));
 assert.equal(groupCustomerInvoices([{id:'x',amount:5},{id:'y',amount:7}]).length,2);
});
test('global search finds an invoice inside its customer while customer-column filters remain specific',()=>{
 const groups=groupCustomerInvoices([{id:'1',customer_code:'A',customer_name:'Milùet',title:'FT 1/242',amount:25}]);
 const columns=[{key:'customer',value:r=>r.customer_name,searchValue:r=>r.customer_name+' '+r.invoices.map(d=>d.title).join(' ')}];
 assert.equal(queryDetailRows(groups,columns,'1/242',{},{}).length,1);
 assert.equal(queryDetailRows(groups,columns,'',{customer:'1/242'},{}).length,0);
});
