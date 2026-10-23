import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { SHEET_FIELDS, defaultLayout, titleBox, templateBoxText, resizeBox, generationContent } from '../shared/directProductSheet.js';
import { textBoxLayout } from '../src/pages/Products/directSheetPdf.js';
import { archiveSheetFiles } from '../shared/directSheetArchive.js';
import { translateSheetContent } from '../server/direct-product-sheets.js';
test('Separate titles use localized headings and their own typography',()=>{
 const layout=defaultLayout(),box=layout.boxes.find(b=>b.field==='description'),title=titleBox(box);
 assert.equal(title.kind,'title');assert.notEqual(title.id,box.id);assert.equal(title.bold,true);assert.equal(box.bold,false);
 assert.equal(templateBoxText(title,{__language:'ENG',description:'Body'}),'Description');
 assert.equal(templateBoxText(box,{__language:'ENG',description:'Body'}),'Body');
 const doc=new jsPDF({unit:'pt'});assert.deepEqual(textBoxLayout(doc,title,layout.pages[0],{__language:'ENG'}).lines,['Description']);
});
test('Photo proportions are retained for numeric and edge-limited resizing',()=>{
 const photo={...defaultLayout().boxes[0],lockAspect:true},ratio=photo.width/photo.height;
 for(const axis of ['width','height'])for(const size of [2,13,80,200]){
  const result=resizeBox(photo,size,size,axis);assert.ok(Math.abs(result.width/result.height-ratio)<1e-10);
  assert.ok(result.x+result.width<=100.00001);assert.ok(result.y+result.height<=100.00001);
 }
 assert.equal(resizeBox({...photo,lockAspect:false},13,8).height,8);
});
test('Category is translated, preserved for review, and stale master categories block generation',async()=>{
 const content=Object.fromEntries(SHEET_FIELDS.map(f=>[f.key,'Text']));content.inci='Aqua';content.category='Cura del corpo';
 const translated=await translateSheetContent(content,'ENG',{generate:async input=>{assert.equal(JSON.parse(input.prompt).category,'Cura del corpo');return {output:{...content,category:'Body care'}};}});
 assert.equal(translated.category_source,'Cura del corpo');assert.equal(translated.category,'Body care');
 const sheet={revision:1,content},rows=[{language:'ENG',source_revision:1,reviewed:true,content:translated}];
 assert.equal(generationContent(sheet,rows,'ENG',{categoria_mexal:'Cura del corpo'}).category,'Body care');
 assert.throws(()=>generationContent(sheet,rows,'ENG',{categoria_mexal:'Viso'}),/Categoria/);
});
test('Saving reports each file, continues after failure, and confirms only verified files',async()=>{
 const states=[],files=[{name:'IT0001_IT.jpeg'},{name:'IT0001_ENG.jpeg'},{name:'IT0001_FR.jpeg'}];
 const results=await archiveSheetFiles({files,prepare:async f=>f,upload:async f=>{if(f.name.includes('ENG'))throw Object.assign(new Error('Timeout'),{name:'TimeoutError'});},confirm:async f=>({saved:true,filename:f.name}),onResult:r=>states.push(r)});
 assert.deepEqual(results.map(r=>r.status),['saved','unconfirmed','saved']);assert.match(results[1].error,/attesa/);assert.equal(states.length,6);
 const unverified=await archiveSheetFiles({files:[files[0]],prepare:async()=>({}),upload:async()=>{},confirm:async()=>({saved:false,filename:files[0].name})});
 assert.equal(unverified[0].status,'unconfirmed');
});
