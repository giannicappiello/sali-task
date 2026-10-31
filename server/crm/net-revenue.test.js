import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceNetAmount,netSalesLineAmount,asNetSalesLine} from '../../shared/netRevenue.js';
test('official invoice net has priority, including zero and credits; fallback never assumes a VAT rate',()=>{
 assert.equal(invoiceNetAmount({totale_imponibile:100,totale_documento:122,totale_iva:22}),100);
 assert.equal(invoiceNetAmount({totale_imponibile:0,totale_documento:122}),0);
 assert.equal(invoiceNetAmount({totale_imponibile:-100}),-100);
 assert.equal(invoiceNetAmount({totale_documento:110,totale_iva:10}),100);
 assert.equal(invoiceNetAmount({totale_documento:100,totale_iva:0}),100);
 assert.equal(invoiceNetAmount({totale_documento:122}),null);
 assert.equal(invoiceNetAmount({},90),90);
});
test('Amazon product revenue subtracts documented tax and preserves source accounting values',()=>{
 const line={external_line_id:'1',line_revenue:122,quantity:2,unit_price:61};
 const order={raw_summary:{provider:'amazon_sp_api',tax_collection:{lines:[{external_line_id:'1',tax_cents:2200}]}}};
 assert.equal(netSalesLineAmount(line,order),100);
 assert.equal(asNetSalesLine(line,order).unit_price,50);
 assert.equal(line.line_revenue,122);
 assert.equal(netSalesLineAmount(line,{marketplace:'Amazon_IT'}),null);
 assert.equal(netSalesLineAmount({line_revenue:100},{marketplace:'website'}),100);
});
