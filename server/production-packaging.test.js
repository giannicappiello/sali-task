import test from "node:test";
import assert from "node:assert/strict";
import {slReferences,parsePackagingSl,recoverPackagingSl,slHeaders} from "./mexal/production-packaging-sl.js";
import {packagingBaseline,productDocuments,productRows} from "../src/features/production-costs/packaging-evidence.js";
import {calculateRecord} from "../src/features/production-costs/cost-engine.js";
import {availableCosts} from "../src/features/production-costs/available-costs.js";
const reference={series:1,number:100,document:"SL 1/100"};
const doc={sigla:"SL",serie:1,numero:100,cod_conto:"501.1",data_documento:"20260804",
 codice_articolo:[[1,"CAP"],[2,"FP1"],[3,"BOX"]],tp_riga:[[1,"R"],[2,"R"],[3,"R"]],
 quantita:[[1,10],[2,2],[3,10]],prezzo:[[1,.5],[2,20],[3,0]],costo_ult:[],
 pos_righe_lotto:[[2,1]],nr_righe_lotto:[[2,2]],id_lotto:[[1,81],[2,82]],qta_lotto:[[1,1],[2,1]]};
const params={reference,year:2026,customer:"501.1",bulkCode:"FP1",packagingCodes:["CAP"],now:"2026-09-14T10:00:00Z"};
const evidence={id:1,customerCode:"501.1",date:"2026-07-01",unit:"PZ",quantity:20,
 productSlReference:"SL 1/100",historicalPackaging:{bulkCode:"FP1",packaging:[{code:"CAP",quantity:20,unitCost:.5}]},
 works:[{id:1,phase:"Confezionamento",state:"Terminato",start:"2026-08-01T09:00:00",end:"2026-08-04T16:00:00",goodQuantity:10,personnel:[]}]};
test("missing customer is resolved from paged SL headers, not guessed",async()=>{
 const calls=[],cache=new Map();
 const client={anno:2026,getJson:async path=>{
  calls.push(path);
  if(path.includes("movimenti-magazzino/SL+"))return doc;
  if(path.includes("next=page2"))return {dati:[{...reference,sigla:"SL",serie:1,numero:100,cod_conto:"501.1"}]};
  return {dati:[{sigla:"FT",serie:1,numero:100,cod_conto:"wrong"}],next:"page2"};
 }};
 const result=await recoverPackagingSl({...evidence,customerCode:""},{now:params.now,clientForYear:()=>client,
  findHeaders:(c,r,o)=>slHeaders(c,r,{...o,cache})});
 assert.equal(result.documents.length,1);
 assert.equal(result.documents[0].customer,"501.1");
 assert.equal(calls.length,3);
});
test("unknown or negative quantities are not rewritten as positive SL quantities",()=>{
 const parsed=parsePackagingSl({...doc,quantita:[[1,-2],[2,null],[3,3]]},params);
 assert.equal(parsed.materials[0].quantity,-2);assert.equal(parsed.materials[1].quantity,null);
});
test("SL references are deduplicated and do not include CL or OC",()=>{
 assert.deepEqual(slReferences("SL 1/100; SL 1/100; CL 1/25; SL+2+44").map(x=>x.document),["SL 1/100","SL 2/44"]);
});
test("historical SL preserves line quantities and lots, bulk need not be first",()=>{
 const parsed=parsePackagingSl(doc,params);
 assert.deepEqual(parsed.materials.map(m=>m.kind),["Packaging","Bulk","Packaging"]);
 assert.equal(parsed.materials[2].unitCost,null);
 assert.deepEqual(parsed.materials[1].lots,[{lotId:81,quantity:1},{lotId:82,quantity:1}]);
 assert.throws(()=>parsePackagingSl(doc,{...params,year:2025}),/Identità/);
 assert.throws(()=>parsePackagingSl(doc,{...params,customer:"501.2"}),/Identità/);
});
test("recovery reads exact existing SL and is idempotent",async()=>{
 const paths=[];
 const options={now:params.now,clientForYear:year=>({getJson:async path=>{paths.push([year,path]);return doc;}})};
 const first=await recoverPackagingSl(evidence,options);
 assert.equal(first.documents.length,1);assert.deepEqual(first.warnings,[]);
 assert.deepEqual(paths,[[2026,"/documenti/movimenti-magazzino/SL+1+100+501.1"]]);
 const again=await recoverPackagingSl({...evidence,historicalProductSl:first.documents},options);
 assert.equal(again.documents.length,1);
});
test("failed retrieval preserves available evidence and exposes warning",async()=>{
 const previous=parsePackagingSl(doc,params);
 const result=await recoverPackagingSl({...evidence,historicalProductSl:[previous]},
  {now:params.now,clientForYear:()=>({getJson:async()=>{throw new Error("offline");}})});
 assert.equal(result.documents.length,1);assert.equal(result.warnings.length,1);
});
test("same reference in multiple years is not silently attributed",async()=>{
 const e={...evidence,works:[{phase:"Confezionamento",start:"2025-12-31",end:"2026-01-02"}]};
 const result=await recoverPackagingSl(e,{now:params.now,clientForYear:year=>({getJson:async()=>({...doc,data_documento:year+"0102"})})});
 assert.equal(result.documents.length,0);assert.match(result.warnings[0],/ambiguo/);
});
test("original documents win, missing documents can be added, originals remain unchanged",()=>{
 const original={document:"SL 1/100",materials:[{code:"FP1",quantity:2},{code:"CAP",quantity:10,unitCost:.4}]};
 const e={...evidence,productSl:[original],historicalProductSl:[parsePackagingSl(doc,params),{...parsePackagingSl(doc,params),document:"SL 1/101"}]};
 assert.equal(productDocuments(e).length,2);
 assert.equal(productRows(e)[1].unitCost,.4);
 assert.equal(e.productSl.length,1);
});
test("packaging is recovered without formula and empty original cannot hide it",()=>{
 const e={...evidence,baseline:{packaging:[]}};
 assert.equal(packagingBaseline(e).rows[0].quantity,20);
 const r=calculateRecord({...e,historicalProductSl:[parsePackagingSl(doc,params)]},null);
 assert.equal(r.plannedPackagingCost,10);
 assert.equal(r.actualPackagingCost,null);
 assert.equal(availableCosts(r).values.actualPackagingCost,5);
 assert.equal(r.actualPackagingRows.length,2);
 assert.deepEqual(e.baseline.packaging,[]);
});
test("valid original packaging and zero remain authoritative; absent codes are supplemented",()=>{
 const e={baseline:{packaging:[{code:"CAP",quantity:0,unitCost:.2}]},historicalPackaging:{packaging:[{code:"CAP",quantity:40,unitCost:1},{code:"BOX",quantity:40,unitCost:2}]}};
 assert.deepEqual(packagingBaseline(e).rows.map(m=>[m.code,m.quantity,m.unitCost]),[["CAP",0,.2],["BOX",40,2]]);
});
test("partial original SL does not hide missing packaging lines",()=>{
 const original={document:"SL 1/100",materials:[{code:"FP1",quantity:2,unitCost:19}]};
 const e={...evidence,productSl:[original],historicalProductSl:[parsePackagingSl(doc,params)]};
 const combined=productDocuments(e);
 assert.equal(combined[0].materials.length,3);
 assert.equal(combined[0].materials[0].unitCost,19);
 assert.equal(original.materials.length,1);
 assert.equal(productRows(e).filter(m=>m.kind==="Packaging").length,2);
});
