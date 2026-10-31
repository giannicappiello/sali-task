
import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {composePdfBatches} from '../shared/screen-export/compose-pdf.js';
import {composePdf} from '../server/company-document-composer.js';
async function source(count=6) {
 const doc=await PDFDocument.create();
 for(let i=0;i<count;i++)doc.addPage([200+i,300]).drawText('Pagina '+i);
 return doc.save();
}
test('large reports compose in bounded requests without missing or reordering pages',async()=>{
 const calls=[];const maxBytes=(await source(1)).length+100;
 const bytes=await composePdfBatches(await source(),async(part,offset)=>{calls.push({size:part.length,offset});return part;},{maxBytes});
 const result=await PDFDocument.load(bytes);
 assert.equal(result.getPageCount(),6);
 assert.deepEqual(result.getPages().map(p=>p.getWidth()),[200,201,202,203,204,205]);
 assert.ok(calls.length>1);assert.equal(calls[0].offset,0);assert.ok(calls.every(c=>c.size<=maxBytes));
});
test('a 413 response is retried with smaller groups and preserves global page offsets',async()=>{
 const calls=[];
 const result=await composePdfBatches(await source(4),async(part,offset)=>{
 const doc=await PDFDocument.load(part);calls.push([offset,doc.getPageCount()]);
 if(doc.getPageCount()>1)throw Object.assign(new Error('too large'),{status:413});
 return part;
 });
 assert.equal((await PDFDocument.load(result)).getPageCount(),4);
 assert.deepEqual(calls.filter(c=>c[1]===1).map(c=>c[0]),[0,1,2,3]);
});
test('cancellation, authorization errors and incomplete composed responses never download a partial report',async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(composePdfBatches(await source(),()=>{}, {signal:controller.signal}),/abort/i);
 await assert.rejects(composePdfBatches(await source(),()=>{throw Object.assign(new Error('denied'),{status:403});}),/denied/);
 await assert.rejects(composePdfBatches(await source(),()=>source(1)),/numero di pagine/);
});
test('batched letterhead composition selects the original global template page',async()=>{
 const template=await PDFDocument.create();
 template.addPage([200,300]).drawText('First letterhead');
 template.addPage([200,300]).drawText('Following letterhead');
 const bytes=await composePdf(await template.save(),await source(1),[],{version:{id:'test',version:1}},{pageOffset:3});
 const output=await PDFDocument.load(bytes);
 assert.equal(output.getPageCount(),1);
 assert.equal(output.getPage(0).getWidth(),200);
});

test('a report larger than the HTTP payload limit composes into a complete PDF using the real composer',async()=>{
 const {randomBytes}=await import('node:crypto');
 const doc=await PDFDocument.create();
 for(let i=0;i<4;i++){
  const page=doc.addPage([200+i,300]);page.drawText('Pagina '+i);
  const comment='%'+randomBytes(1024*1024).toString('hex')+'\n';
  page.node.addContentStream(doc.context.register(doc.context.flateStream(new TextEncoder().encode(comment))));
 }
 const sourceBytes=await doc.save();assert.ok(sourceBytes.length>4.5*1024*1024);
 const header=await PDFDocument.create();header.addPage([200,300]).drawText('PROGRE');
 const template=await header.save();const calls=[];
 const merged=await composePdfBatches(sourceBytes,async(part,pageOffset)=>{
  calls.push(part.length);assert.ok(part.length<=2*1024*1024);
  const result=await composePdf(template,part,[],{version:{id:'test',version:1}},{pageOffset});
  assert.ok(result.length*4/3<4.5*1024*1024);
  return result;
 });
 assert.equal((await PDFDocument.load(merged)).getPageCount(),4);assert.equal(calls.length,4);
});
