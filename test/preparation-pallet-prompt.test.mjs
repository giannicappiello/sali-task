/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {preparationDatabase,supabaseAdapter,mexalFixture,actor,event} from './order-preparation-fixture.mjs';
import {createOrderPreparationHandler} from '../server/order-preparation-handler.js';
import {saveMissingPreparationPackaging} from '../server/order-preparation-packaging.js';

async function fixture(){
 const {PGlite}=await import(process.env.PGLITE_MODULE),sql=await preparationDatabase(PGlite),db=supabaseAdapter(sql),mexal=mexalFixture();let row,writable=true;
 const handler=createOrderPreparationHandler({authorize:async()=>({db,profile:{id:actor},canWrite:writable,canConfigure:false}),clientFactory:()=>mexal});
 async function call(operation,input={}){const res={setHeader(){},status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}};await handler({method:'POST',body:{operation,id:row?.id,version:row?.version,eventId:event(),...input}},res);if(res.data.preparation)row=res.data.preparation;return res;}
 async function ok(operation,input){const r=await call(operation,input);assert.equal(r.statusCode,200,JSON.stringify(r.data));return r.data;}
 await ok('begin',{reference:'OC+1+900'});await ok('add_pallet',{palletId:event(),assignUnassigned:true});
 const request={id:row.id,version:row.version,eventId:event(),barcode:'IT0001',mode:'pallet',packageId:row.state.packages[0].id,palletId:row.state.pallets[0].id};
 return {sql,db,call,ok,request,get row(){return row;},readonly(){writable=false;}};
}

test('missing pallet boxes are prompted inline, saved in the canonical revision and the same capture creates the exact cartons once',{skip:!process.env.PGLITE_MODULE},async()=>{
 const f=await fixture();try{
  const before=(await f.sql.query("select * from workspace_product_specifications where article_code='IT0001'")).rows[0];
  const prompt=await f.ok('scan',f.request);
  assert.equal(prompt.requiresPalletBoxes,true);assert.equal(prompt.requiresCartonPieces,false);assert.equal(prompt.requiresProductWeight,false);
  assert.equal(f.row.state.scans.length,0);assert.equal((await f.sql.query("select version from workspace_product_specifications where article_code='IT0001'")).rows[0].version,before.version);
  const saved=await f.ok('scan',{...f.request,boxesPerPallet:3});
  assert.equal(saved.scan.quantity,6);assert.equal(f.row.state.packages.length,3);assert.equal(f.row.state.scans.length,3);
  assert(f.row.state.scans.every(scan=>scan.boxesPerPallet===3 && scan.piecesPerCarton===2 && scan.specificationVersion===before.version+1));
  const spec=(await f.sql.query("select * from workspace_product_specifications where article_code='IT0001'")).rows[0];
  assert.equal(spec.data.boxesPerPallet,'3');assert.equal(spec.data.piecesPerBox,before.data.piecesPerBox);assert.equal(spec.data.totalWeightGrams,before.data.totalWeightGrams);assert.equal(spec.data.customer,before.data.customer);
  assert.deepEqual(spec.attachments,before.attachments);assert.equal(spec.updated_by,actor);
  assert.equal((await f.sql.query("select count(*)::int n from workspace_product_specification_revisions where article_code='IT0001'")).rows[0].n,1);
  await f.ok('scan',{...f.request,boxesPerPallet:3});assert.equal(f.row.state.scans.length,3);
  assert.equal((await f.sql.query("select version from workspace_product_specifications where article_code='IT0001'")).rows[0].version,spec.version);
 }finally{await f.sql.close();}
});

test('pieces, boxes and product weight are collected together and partial or invalid values do not mutate the specification or scans',{skip:!process.env.PGLITE_MODULE},async()=>{
 const f=await fixture();try{
  await f.sql.exec("update workspace_product_specifications set data='{\"customer\":\"private\"}' where article_code='IT0001'");
  const prompt=await f.ok('scan',f.request);assert(prompt.requiresPalletBoxes && prompt.requiresCartonPieces && prompt.requiresProductWeight);
  const partial=await f.ok('scan',{...f.request,piecesPerCarton:4,boxesPerPallet:3});assert(partial.requiresProductWeight);
  for(const boxes of [0,1.5,2001])assert.equal((await f.call('scan',{...f.request,piecesPerCarton:4,boxesPerPallet:boxes,unitWeightGrams:1250})).statusCode,400);
  assert.equal((await f.call('scan',{...f.request,piecesPerCarton:500001,boxesPerPallet:3,unitWeightGrams:1250})).statusCode,400);
  assert.equal(f.row.state.scans.length,0);assert.equal((await f.sql.query("select version from workspace_product_specifications where article_code='IT0001'")).rows[0].version,3);
  const saved=await f.ok('scan',{...f.request,piecesPerCarton:4,boxesPerPallet:3,unitWeightGrams:'1250,5'});assert.equal(saved.scan.quantity,12);
  const spec=(await f.sql.query("select data,version from workspace_product_specifications where article_code='IT0001'")).rows[0];
  assert.equal(spec.version,4);assert.deepEqual([spec.data.piecesPerBox,spec.data.boxesPerPallet,spec.data.totalWeightGrams],['4','3','1250.5']);
 }finally{await f.sql.close();}
});

test('carton and piece modes do not require pallet boxes and existing values, malformed fields and permissions remain protected',{skip:!process.env.PGLITE_MODULE},async()=>{
 const f=await fixture();try{
  const piece=await f.ok('scan',{...f.request,mode:'piece'});assert.equal(piece.scan.quantity,1);assert(!piece.requiresPalletBoxes);
  const carton=await f.ok('scan',{...f.request,eventId:event(),version:f.row.version,mode:'carton'});assert.equal(carton.scan.quantity,2);assert(!carton.requiresPalletBoxes);
  await f.sql.exec("update workspace_product_specifications set data=data||'{\"boxesPerPallet\":\"5\"}' where article_code='IT0001'");
  const result=await saveMissingPreparationPackaging(f.db,'IT0001',{boxesPerPallet:3},actor);assert.equal(result.boxesPerPallet,5);assert.equal(result.packagingSpecificationVersion,3);
  await f.sql.exec("update workspace_product_specifications set data=data||'{\"boxesPerPallet\":\"1.5\"}' where article_code='IT0001'");
  const bad=await f.call('scan',{...f.request,eventId:event(),version:f.row.version,boxesPerPallet:3});assert.equal(bad.statusCode,400);assert.match(bad.data.error,/Colli per bancale/);
  f.readonly();assert.equal((await f.call('scan',{...f.request,eventId:event(),version:f.row.version,boxesPerPallet:3})).statusCode,403);
 }finally{await f.sql.close();}
});

import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'rolldown/experimental';

const promptSource=readFileSync(new URL('../src/pages/Warehouse/PreparationProductPrompt.jsx',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace('export default function','function');
const promptCompiled=transformSync('PreparationProductPrompt.jsx',promptSource,{jsx:{runtime:'classic'}});
assert.equal(promptCompiled.errors?.length || 0,0);
const Prompt=new Function('React','useEffect','useRef',promptCompiled.code+';return PreparationProductPrompt;')(React,React.useEffect,React.useRef);
test('the same camera/manual prompt collects pallet boxes alongside pieces and weight and prevents incomplete submission',()=>{
 const props={prompt:{code:'IT0084',needsBoxes:true,needsPieces:true,needsWeight:true,operation:'scan'},pieces:'',boxes:'',weight:'',onBoxes(){},onPieces(){},onWeight(){},onSave(){},onCancel(){},busy:false};
 const empty=renderToStaticMarkup(React.createElement(Prompt,props));
 assert(empty.includes('aria-label="Colli per bancale"'));assert(empty.includes('aria-label="Pezzi per cartone"'));assert(empty.includes('aria-label="Peso Totale in grammi"'));
 assert.match(empty,/<button type="submit" disabled=""/);
 const filled=renderToStaticMarkup(React.createElement(Prompt,{...props,pieces:'12',boxes:'40',weight:'1100'}));
 assert.match(filled,/<button type="submit">Salva e conferma lettura/);
 const boxesOnly=renderToStaticMarkup(React.createElement(Prompt,{...props,prompt:{code:'IT0084',needsBoxes:true},boxes:'40'}));
 assert.equal((boxesOnly.match(/<input /g)||[]).length,1);assert(boxesOnly.includes('value="40"'));
});
