import test from "node:test";
import assert from "node:assert/strict";
import { recoverProductionOct,readProductionOct } from "./mexal/production-oct.js";
import { octTargets,recoveredOctShare } from "../src/features/production-costs/oct-evidence.js";
import { resolveOctRevenue } from "../src/features/production-costs/commercial-revenue.js";
import { displayRecord } from "../src/features/production-costs/cost-display.js";

const evidence={id:24,orderNumber:"OC/2/40",articleCode:"FP123L",unit:"KG",quantity:50,date:"2026-07-20",
 sourceOrder:{mesLineId:812,reference:"OC/2/40",date:"2026-02-02",customerCode:"501.02267",articleCode:"FP123L",unit:"KG",quantity:100,lineValue:0}};
const doc={sigla:"OC",cod_modulo:"T",serie:2,numero:40,cod_conto:"501.02267",data_documento:"20260202",
 codice_articolo:[[1,"FP123L"]],quantita:[[1,100]],prezzo:[[1,20]],sconto:[[1,"50+10"]],unita_misura:[[1,"KG"]]};
const now="2026-09-14T09:00:00Z";
const client=payload=>({getJson:async()=>payload});
const read=d=>readProductionOct(d,{target:octTargets(evidence)[0],year:2026,mexal:client({}),now});
const enriched=async()=>({...evidence,recoveredOctLines:[await read(doc)]});

test("recover missing MES zero from exact original customer order with discounts, excluding VAT",async()=>{
 const calls=[];
 const result=await recoverProductionOct(evidence,{now,clientForYear:y=>({getJson:async path=>{calls.push([y,path]);return doc;}})});
 assert.deepEqual(calls,[[2026,"/documenti/ordini-clienti/OC%2B2%2B40"]]);
 assert.equal(result.lines[0].lineValue,900);assert.deepEqual(result.warnings,[]);
 const e={...evidence,recoveredOctLines:result.lines};
 const commercial=resolveOctRevenue(e,[],[e]);assert.equal(commercial.octRevenue,450);
 const summary=displayRecord({...e,phases:[],commercial,actualTotal:300,plannedObjective:0});
 assert.equal(summary.octRevenue,450);assert.equal(summary.octActualMargin,150);
 assert.equal(displayRecord(summary.completeCosts).octRevenue,summary.octRevenue);
});
test("explicit original net value takes precedence; actual zero is not missing",async()=>{
 assert.equal((await read({...doc,imponibile_riga:[[1,123.45]]})).lineValue,123.45);
 assert.equal((await read({...doc,prezzo:[[1,0]]})).lineValue,0);
 await assert.rejects(read({...doc,prezzo:undefined}),/Prezzo/);
});
test("customer, document year, product, units and repeated article rows must match",async()=>{
 for(const changed of [{cod_conto:"other"},{data_documento:"20250202"},{numero:90},{codice_articolo:[[1,"OTHER"]]},
  {unita_misura:[[1,"PZ"]]},{codice_articolo:[[1,"FP123L"],[2,"FP123L"]]}])await assert.rejects(read({...doc,...changed}));
});
test("primary unit is recovered from article only for explicit Mexal unit type 1",async()=>{
 const d={...doc,unita_misura:undefined,tp_um_articolo:[[1,"1"]]};
 const row=await readProductionOct(d,{target:octTargets(evidence)[0],year:2026,mexal:client({unita_misura:"KG"}),now});
 assert.equal(row.unit,"KG");
 await assert.rejects(read({...d,tp_um_articolo:[[1,"2"]]}),/Unità/);
});
test("actual OCT overrides stale positive legacy revenue, not just legacy zeros",async()=>{
 const e=await enriched();e.sourceOrder.lineValue=9999;
 assert.equal(resolveOctRevenue(e,[],[e]).octRevenue,450);
});
test("shared original line is apportioned once, including siblings not yet recovered",async()=>{
 const e=await enriched(),other={...evidence,id:25,quantity:40,sourceOrder:{...evidence.sourceOrder,mesLineId:900}};
 assert.equal(resolveOctRevenue(e,[],[e,other]).octRevenue,450);
 assert.equal(resolveOctRevenue(e,[],[e,{...other,quantity:51}]).octRevenue,900*50/101);
});
test("unrelated years and customers never consume another order's allocation",async()=>{
 const e=await enriched(),other={...evidence,id:25,quantity:999,sourceOrder:{...evidence.sourceOrder,date:"2025-02-02"}};
 assert.equal(resolveOctRevenue(e,[],[e,other]).octRevenue,450);
 assert.equal(resolveOctRevenue(e,[],[e,{...other,sourceOrder:{...other.sourceOrder,date:"2026-02-02",customerCode:"other"}}]).octRevenue,450);
});

test("cancelled duplicate does not consume original order quantity, active siblings still do",async()=>{
 const e=await enriched();
 const duplicate={...evidence,id:5436,quantity:100,state:"Annullato"};
 assert.equal(resolveOctRevenue(e,[],[e,duplicate]).octRevenue,450);
 assert.equal(resolveOctRevenue(e,[],[e,{...duplicate,state:"DaAvviare"}]).octRevenue,300);
 assert.equal(resolveOctRevenue(e,[],[e,{...duplicate,state:"Completato"}]).octRevenue,300);
});
test("stale recovery cannot follow production when article changes",async()=>{
 const e={...await enriched(),articleCode:"OTHER"};
 assert.equal(resolveOctRevenue(e,[],[e]).octRevenue,null);
});
test("without original date, prior year is searched but ambiguous matches refused",async()=>{
 const e={...evidence,sourceOrder:null};
 const make=y=>({...doc,data_documento:`${y}0202`});
 const ambiguous=await recoverProductionOct(e,{now,clientForYear:y=>client(make(y))});
 assert.equal(ambiguous.lines.length,0);assert.match(ambiguous.warnings[0],/più anni/);
 const one=await recoverProductionOct(e,{now,clientForYear:y=>client({...make(y),codice_articolo:[[1,y===2025?"FP123L":"OTHER"]]})});
 assert.equal(one.lines[0].year,2025);
});
test("transient failures retain prior verified data with explicit warning and original timestamp",async()=>{
 const e=await enriched(),r=await recoverProductionOct(e,{now,clientForYear:()=>({getJson:async()=>{throw {status:503};}})});
 assert.deepEqual(r.lines,e.recoveredOctLines);assert.equal(r.warnings.length,1);
});
test("multiple explicit customer links use their own real row amounts",async()=>{
 const e=await enriched();e.links=[{lineId:"x",oct:"OCT/2/40",customerCode:"501.02267",quantity:50,unit:"KG"}];
 e.recoveredOctLines[0].targetKey="x";
 assert.equal(resolveOctRevenue(e,[],[e]).octRevenue,450);
});
test("sparse matrix row positions and localized amounts are preserved",async()=>{
 const d={...doc,codice_articolo:[[7,"FP123L"]],quantita:[[7,"100"]],prezzo:[[7,"20,50"]],sconto:[[7,"50"]],unita_misura:[[7,"KG"]]};
 assert.equal((await read(d)).lineValue,1025);
});
test("negative, empty or zero attributed quantities cannot manufacture a revenue",async()=>{
 for(const quantity of [null,"",-1,0]){
  const e={...await enriched(),quantity};
  assert.equal(recoveredOctShare(e,octTargets(e)[0],[e]).value,null);
 }
});
test("partial original recovery retains another explicitly linked Workspace OCT amount",async()=>{
 const e=await enriched();
 e.links=[{lineId:"x",oct:"OC/2/40",customerCode:"501.02267",quantity:50,unit:"KG"},
  {lineId:"y",oct:"OC/2/41",customerCode:"501.02267",quantity:10,unit:"KG"}];
 e.recoveredOctLines[0].targetKey="x";
 const row={id:"y",codice_articolo:"FP123L",quantita:10,unita_misura_oct:"KG",imponibile_riga:200};
 const result=resolveOctRevenue(e,[row],[e]);
 assert.equal(result.octRevenue,650);assert.equal(result.octPartial,false);
 assert.equal(resolveOctRevenue(e,[],[e]).octPartial,true);
});
test("a changed original order year invalidates a previous recovery",async()=>{
 const e=await enriched();e.sourceOrder={...e.sourceOrder,date:"2025-02-02"};
 assert.equal(resolveOctRevenue(e,[],[e]).octRevenue,null);
});
