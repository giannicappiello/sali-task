import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {parseOrderWorkbook} from './order-excel.js';
import {combineOrderExtractions,extractOrderVision} from './order-import-extraction.js';
test('all workbook sheets without headers identifying an order reach a single draft',()=>{
 const book=XLSX.utils.book_new();
 for(const name of ['Corpo','Viso','Capelli']) XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Codice','Descrizione','Quantità'],['IT001',name,2]]),name);
 const parsed=parseOrderWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
 const result=combineOrderExtractions(parsed.orders);
 assert.equal(result.lines.length,3);
 assert.deepEqual(result.lines.map(l=>l.sheetName),['Corpo','Viso','Capelli']);
 assert.equal(result.lines.reduce((sum,l)=>sum+l.quantity,0),6);
});
test('conflicting customer identities require selection while preserving all lines',()=>{
 const combined=combineOrderExtractions([{customer:{code:'A'},lines:[{quantity:2}]},{customer:{code:'B'},lines:[{quantity:3}]}]);
 assert.equal(combined.customerConflict,true);assert.deepEqual(combined.customer,{});assert.equal(combined.lines.length,2);
});
test('continuation sheets inherit customer from first sheet',()=>{
 const combined=combineOrderExtractions([{customer:{name:'Farmacia'},lines:[1]},{customer:{name:''},lines:[2]}]);
 assert.equal(combined.customer.name,'Farmacia');assert.deepEqual(combined.lines,[1,2]);
});
test('PDF bytes reach generator unchanged with adequate output budget',async()=>{
 const messages=[{role:'user',content:[{type:'file',mediaType:'application/pdf',data:Buffer.from('%PDF-1.7')}]}];
 await extractOrderVision(async options=>{assert.equal(options.messages,messages);assert.equal(options.maxOutputTokens,16000);return {finishReason:'stop',output:{lines:[{quantity:1}]}};},{messages});
});
test('truncated PDF response retries once and never returns incomplete lines',async()=>{
 let calls=0;const r=await extractOrderVision(async()=>++calls===1?{finishReason:'length',output:{lines:[1]}}:{finishReason:'stop',output:{lines:[1,2]}} ,{});
 assert.equal(calls,2);assert.equal(r.output.lines.length,2);
});
test('persistent missing PDF output returns actionable error after bounded retry',async()=>{
 let calls=0;await assert.rejects(extractOrderVision(async()=>{calls++;throw new Error('No output generated.');},{}),/PDF.*leggibile/);assert.equal(calls,2);
});
