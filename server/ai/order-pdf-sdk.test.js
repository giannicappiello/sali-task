import { PDFDocument,StandardFonts } from 'pdf-lib';
import { generateText,Output,jsonSchema } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { extractOrderVision } from './order-import-extraction.js';
import test from 'node:test';
import assert from 'node:assert/strict';

test('two-page valid PDF passes real SDK file conversion and structured output',async()=>{
 const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);
 for(const [i,code] of ['IT100','IT200'].entries()){const page=pdf.addPage();page.drawText(`TEST ORDER - page ${i+1} - ${code} quantity ${i+2}`,{x:40,y:700,font,size:14});}
 const bytes=Buffer.from(await pdf.save());assert.equal((await PDFDocument.load(bytes)).getPageCount(),2);
 let inspected=false;
 const model=new MockLanguageModelV3({supportedUrls:{},doGenerate:async(options)=>{
  const file=options.prompt.flatMap(m=>Array.isArray(m.content)?m.content:[]).find(p=>p.type==='file');
  assert.equal(file.mediaType,'application/pdf');assert.equal((await PDFDocument.load(file.data.data ?? file.data)).getPageCount(),2);inspected=true;
  return {content:[{type:'text',text:JSON.stringify({lines:[{productCode:'IT100',quantity:2},{productCode:'IT200',quantity:3}]})}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:100},outputTokens:{total:40}},warnings:[]};
 }});
 const result=await extractOrderVision(generateText,{model,messages:[{role:'user',content:[{type:'file',mediaType:'application/pdf',data:bytes,filename:'test-two-pages.pdf'}]}],output:Output.object({schema:jsonSchema({type:'object',properties:{lines:{type:'array',items:{type:'object',properties:{productCode:{type:'string'},quantity:{type:'number'}},required:['productCode','quantity']}}},required:['lines']})})});
 assert.equal(inspected,true);assert.equal(result.output.lines.length,2);assert.equal(result.output.lines.reduce((n,l)=>n+l.quantity,0),5);
});


