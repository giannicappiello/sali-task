import test from "node:test";
import assert from "node:assert/strict";
import { resolveOctRevenue } from "../src/features/production-costs/commercial-revenue.js";
import { displayRecord,costRows } from "../src/features/production-costs/cost-display.js";
import { costVariance,costVariancePercent,calculateRecord } from "../src/features/production-costs/cost-engine.js";
import { signedMoney,signedPercent } from "../src/features/production-costs/client.js";

const source={mesLineId:1,articleCode:"FP1",unit:"KG",quantity:100,lineValue:1000};
const evidence={id:1,articleCode:"FP1",unit:"KG",quantity:50,sourceOrder:source};
const link={lineId:"l1",oct:"OCT/1/10",quantity:50,unit:"KG"};
const row={id:"l1",quantita:100,unita_misura_oct:"kg",imponibile_riga:1000};
test("legacy OCT uses attributed quantity, not entire document",()=>{
 const c=resolveOctRevenue(evidence,[],[evidence]);
 assert.equal(c.octRevenue,500);assert.equal(c.octPartial,false);assert.deepEqual(c.octReasons,[]);
});
test("missing OCT explains absent link, wrong product, absent price and over-allocation",()=>{
 const absent=resolveOctRevenue({},[],[]);assert.equal(absent.octRevenue,null);assert.match(absent.octReasons[0],/Collegamento/);
 const wrong=resolveOctRevenue({...evidence,articleCode:"PF1"},[],[evidence]);assert.equal(wrong.octRevenue,null);assert.match(wrong.octReasons[0],/diverso/);
 const noPrice=resolveOctRevenue({...evidence,sourceOrder:{...source,lineValue:0}},[],[evidence]);assert.equal(noPrice.octRevenue,null);assert.match(noPrice.octReasons[0],/Valore netto/);
 const over=resolveOctRevenue(evidence,[],[evidence,{...evidence,id:2,quantity:60}]);assert.equal(over.octRevenue,1000*50/110);
});
test("Workspace OCT preserves known shares and flags missing linked lines",()=>{
 const c=resolveOctRevenue({links:[link,{...link,lineId:"missing"}]},[row],[]);
 assert.equal(c.octRevenue,500);assert.equal(c.octPartial,true);assert.match(c.octReasons[0],/non disponibile/);
});
test("OCT rejects incompatible units or unverified quantity; explicit net zero is retained",()=>{
 for(const bad of [{...link,unit:"PZ"},{...link,quantity:null}]){
  assert.equal(resolveOctRevenue({links:[bad]},[row],[]).octRevenue,null);
 }
 assert.equal(resolveOctRevenue({links:[link]},[{...row,imponibile_riga:0}],[]).octRevenue,0);
});
test("OCT and invoices remain separate; comparison uses actual cost displayed",()=>{
 const d=displayRecord({phases:[],plannedTotal:400,actualTotal:300,plannedObjective:0,commercial:{octRevenue:500},actualRevenue:200});
 assert.equal(d.totalVariance,100);assert.equal(d.variancePercent,25);assert.equal(d.octRevenue,500);
 assert.equal(d.octActualMargin,200);assert.equal(d.costPartial.octActualMargin,false);
 assert.equal(costRows(d).some(r=>r.name==="Ricavo OCT / fatture"),false);
 assert.equal(costRows(d).filter(r=>r.total).length,1);
});
test("estimated selling price is never labelled as OCT; missing inputs not invented",()=>{
 const d=displayRecord({phases:[],plannedRevenue:1000,actualTotal:300,commercial:{octRevenue:null}});
 assert.equal(d.octRevenue,null);assert.equal(d.octActualMargin,null);
 assert.equal(displayRecord({phases:[],commercial:{octRevenue:1000}}).octActualMargin,null);
});
test("partial actual cost and partial OCT preserve comparison with flag",()=>{
 const d=displayRecord({plannedObjective:0,phases:[{phase:"Semilavorato",actualLabor:100}],commercial:{octRevenue:500,octPartial:true}});
 assert.equal(d.actualTotal,100);assert.equal(d.octActualMargin,400);assert.equal(d.costPartial.octActualMargin,true);
});
test("savings have explicit plus, overruns negative, percentages use forecast denominator",()=>{
 assert.equal(costVariance(3073.95,3942.70).toFixed(2),"868.75");
 assert.equal(costVariancePercent(75,100),25);assert.equal(costVariancePercent(125,100),-25);
 assert.equal(costVariancePercent(1,0),null);assert.equal(costVariance(null,100),null);
 assert.match(signedMoney(868.75),/^\+/);assert.match(signedMoney(-5),/^-5/);assert.equal(signedPercent(25),"+25%");
});
test("material savings and price savings sum to forecast minus actual cost",()=>{
 const r=calculateRecord({baseline:{materials:[{code:"M",quantity:100,unitCost:3}]},bulkSl:[{materials:[{code:"M",quantity:90,unitCost:2}]}],works:[]},null);
 assert.equal(r.materialVariances[0].usageVariance,30);assert.equal(r.materialVariances[0].priceVariance,90);
});
test("cost per conforming piece excludes scrap and does not apply to bulk or KG",()=>{
 const base={productActualTotal:100,goodQuantity:80,phases:[{phase:"Confezionamento",scrapQuantity:20}],unit:"PZ"};
 assert.equal(displayRecord(base).unitCost,1.25);
 for(const r of [{...base,unit:"KG"},{...base,phases:[{phase:"Semilavorato"}]}]){
  assert.equal(displayRecord(r).unitCost,null);assert.equal(displayRecord(r).unitCostApplicable,false);
 }
});

 test("Workspace overproduction caps the order amount and preserves shared totals",()=>{
 const a={id:1,links:[{...link,quantity:120}]},b={id:2,links:[{...link,quantity:80}]};
 assert.equal(resolveOctRevenue(a,[row],[a]).octRevenue,1000);
 assert.equal(resolveOctRevenue(a,[row],[a,b]).octRevenue+resolveOctRevenue(b,[row],[a,b]).octRevenue,1000);
 });
