import { jpegWithDpi, SHEET_EXPORT_DPI } from '../shared/directSheetResolution.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { SHEET_FIELDS, defaultLayout, titleBox, templateBoxText, resizeBox, generationContent, photoCrop, photoSourceRect } from '../shared/directProductSheet.js';
import { textBoxLayout, buildDirectSheetPdf } from '../src/pages/Products/directSheetPdf.js';
import { archiveSheetFiles } from '../shared/directSheetArchive.js';
import { translateSheetContent } from '../server/direct-product-sheets.js';
test('Separate titles use localized headings and their own typography',()=>{
 const layout=defaultLayout(),box=layout.boxes.find(b=>b.field==='description'),title=titleBox(box);
 assert.equal(title.kind,'title');assert.notEqual(title.id,box.id);assert.equal(title.bold,true);assert.equal(box.bold,false);
 assert.equal(templateBoxText(title,{__language:'ENG',description:'Body'}),'Description');
 assert.equal(templateBoxText(box,{__language:'ENG',description:'Body'}),'Body');
 assert.equal(templateBoxText({...title,titleCase:'uppercase'},{__language:'ENG'}),'DESCRIPTION');
 assert.equal(templateBoxText({...title,titleCase:'lowercase'},{__language:'IT'}),'descrizione');
 assert.equal(templateBoxText({...title,field:'category',titleCase:'uppercase'},{__language:'FR'}),'CATÉGORIE');
 assert.equal(templateBoxText({...box,titleCase:'uppercase'},{description:'Body'}),'Body');
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

test('Photo crop clamps malformed and out-of-bounds rectangles and maps to source pixels',()=>{
 assert.deepEqual(photoCrop(),{x:0,y:0,width:100,height:100});
 assert.deepEqual(photoSourceRect(400,200,{x:25,y:10,width:50,height:80}),[100,20,200,160]);
 assert.deepEqual(photoCrop({x:99,y:-20,width:200,height:NaN}),{x:99,y:0,width:1,height:100});
 for(const crop of [null,{}, {x:Infinity,y:'wrong',width:-3,height:200}]){const r=photoCrop(crop);assert.ok(r.width>=1&&r.height>=1&&r.x+r.width<=100&&r.y+r.height<=100);}
});

test('Overlapping title and content boxes do not block PDF generation',async()=>{
 const base=defaultLayout(),body=base.boxes.find(box=>box.field==='description');
 const title={...titleBox(body),x:body.x,y:body.y,width:body.width,height:body.height,titleCase:'uppercase'};
 const result=await buildDirectSheetPdf({layout:{...base,boxes:[body,title]},values:{description:'Short body text',__language:'ENG'}});
 assert.ok(result.doc.internal.pages.flat().join('\n').includes('DESCRIPTION'));assert.ok(result.doc.internal.pages.flat().join('\n').includes('Short body text'));
});

test('Overflow is reported without blocking preview generation',async()=>{
 const base=defaultLayout(),body={...base.boxes.find(box=>box.field==='description'),height:2,fontSize:60};
 const result=await buildDirectSheetPdf({layout:{...base,boxes:[body]},values:{description:'This deliberately long text extends beyond its box.'}});
 assert.ok(result.doc.output().startsWith('%PDF-'));assert.ok(result.doc.output().includes('/FlateDecode')); assert.equal(result.warnings.length,1);assert.match(result.warnings[0],/fuori casella/);
});

test('JPEG print density is 300 dpi without recompressing image data or duplicating JFIF',()=>{
 const original=new Uint8Array([255,216,255,217]);const result=jpegWithDpi(original);
 assert.equal(SHEET_EXPORT_DPI,300);assert.equal(result[13],1);assert.equal(result[14]*256+result[15],300);assert.equal(result[16]*256+result[17],300);
 assert.deepEqual([...result.slice(-2)],[255,217]);assert.equal(jpegWithDpi(result).length,result.length);
 assert.equal(jpegWithDpi(result,600)[14]*256+jpegWithDpi(result,600)[15],600);
 assert.throws(()=>jpegWithDpi(new Uint8Array([1,2])),/JPEG/);
});
