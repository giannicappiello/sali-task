import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizePeriod, eventImpact, sumDocuments, readAllRows, loadCrmBeautyDashboard, loadCrmBeautyCustomer } from "../../supabase/functions/report-giornate-api/crmBeautyData.js";
import { beautyDetailEvents, postEventOrderValue } from "../../src/modules/crm/crmBeautyData.js";
const read = path => readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const period={from:"2026-06-01",to:"2026-06-30"};
const order=(id,date,value,code="A")=>({id,codice_cliente:code,data_ordine:date,totale_documento:value});
const commercial={orders:[order("before","2026-06-01",10),order("same","2026-06-10",20),order("after","2026-06-11",30),order("end","2026-07-10",40),order("outside","2026-07-11",50),order("other","2026-06-12",100,"B")],invoices:[]};
const day={id:"d1",data:"2026-06-10",stato:"eseguita",customer_code:"A"};

test("post-event means next day through configured end, same pharmacy, executed only",()=>{
 const impact=eventImpact(day,"A",commercial,30);
 assert.equal(impact.order_value,70);
 assert.deepEqual(impact.orders.map(x=>x.id),["after","end"]);
 assert.equal(eventImpact({...day,stato:"pianificata"},"A",commercial,30).order_value,0);
});
test("money summation is cent exact and deduplicates canonical order IDs",()=>{
 assert.equal(sumDocuments([order("a","",0.1),order("b","",0.2),order("a","",0.1)]),0.3);
});
test("period validates complete ISO dates and inclusive ordered range",()=>{
 assert.deepEqual(normalizePeriod(period),period);
 for(const invalid of [{from:"2026-02-30",to:"2026-03-02"},{from:"2026-07-01",to:"2026-06-01"},{from:"2026-01-01"}]) assert.throws(()=>normalizePeriod(invalid),/Periodo/);
 assert.equal(normalizePeriod(),null);
});
function database(tables,errors={}) {
  const calls=[];
  return {calls,from(table){
  if (!(table in tables)) throw new Error(`Unknown database relation: ${table}`);
  const filters=[],orders=[];
  const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,v){calls.push([table,k,[...v]]);filters.push(r=>v.includes(r[k]));return q},
   gte(k,v){filters.push(r=>r[k]>=v);return q},lte(k,v){filters.push(r=>r[k]<=v);return q},
   order(k,opt){orders.push([k,opt?.ascending!==false]);return q},
   async range(from,to){let rows=(tables[table]||[]).filter(r=>filters.every(f=>f(r)));
    rows=[...rows].sort((a,b)=>{for(const [key,asc] of orders){const diff=String(a[key]||"").localeCompare(String(b[key]||""));if(diff)return asc?diff:-diff}return 0});
    return {data:rows.slice(from,to+1),error:errors[table]||null};}};
  return q;
 }};
}
function sources({missingName=false,error=null,extraOrders=[]}={}) {
 return {
 primary:database({
  beauty_clienti_mexal:[{codice_cliente:"A",legacy_farmacia_id:"f1",beauty_external_id:"c1"}],
  ordini_clienti_cache:missingName?[]:[{codice_cliente:"A",ragione_sociale:"Farmacia Canonica"}],
  crm_order_kpi_source:[...commercial.orders,...extraOrders],mexal_fatture_vendita:[],
 },error?{crm_order_kpi_source:error}:{}),
 report:database({
  giornate_promozionali:[{...day,farmacia_id:"f1",consultant_id:"c1",numero_totale_pezzi_venduti:2,fatturato_giornata:12},
    {...day,id:"d2",data:"2026-06-20",farmacia_id:"f1",consultant_id:"c1",numero_totale_pezzi_venduti:3,fatturato_giornata:18},
    {...day,id:"outside-event",data:"2026-07-01",farmacia_id:"f1"},
    {...day,id:"invisible",farmacia_id:"f2"}],
  farmacie:[{id:"f1",nome:"Farmacia Report"},{id:"f2",nome:"NON AUTORIZZATA"}],
  beauty_consultant:[{id:"c1",nome:"Beauty",cognome:"Test"}],vendite_prodotti:[],
 })};
}
test("dashboard returns canonical name and complete period orders even before first event",async()=>{
 const {primary,report}=sources();
 const result=await loadCrmBeautyDashboard(primary,report,30,period);
 assert.equal(result.events.length,2);
 assert.ok(result.events.every(e=>e.customer_name==="Farmacia Canonica" && e.period_order_value===60));
 assert.equal(result.events.find(e=>e.id==="d1").impact.order_value,70);
 assert.equal(result.events.find(e=>e.id==="d2").impact.order_value,90);
 // Shared July 10 order counted once; July 11 belongs only to the second window.
 assert.equal(result.metrics.post_event_order_value,120);
 assert.equal(postEventOrderValue(result.events),120);
 assert.ok(!JSON.stringify(result).includes("NON AUTORIZZATA"));
 assert.ok(report.calls.filter(([table])=>table==="giornate_promozionali").every(([,key,ids])=>key==="farmacia_id"&&ids.every(id=>id==="f1")));
});
test("pharmacy summary aggregates events but never multiplies period totals or shared orders",async()=>{
 const {primary,report}=sources();
 const result=await loadCrmBeautyDashboard(primary,report,30,period);
 const rows=beautyDetailEvents(result.events,"customers");
 assert.equal(rows.length,1);
 assert.equal(rows[0].period_order_value,60);
 assert.equal(rows[0].impact.order_value,120);
 assert.equal(rows[0].numero_totale_pezzi_venduti,5);
 assert.equal(rows[0].fatturato_giornata,30);
 assert.equal(rows[0].first_event_date,"2026-06-10");
 assert.equal(rows[0].data,"2026-06-20");
});
test("fallback is the real Report pharmacy name, never the code",async()=>{
 const {primary,report}=sources({missingName:true});
 assert.equal((await loadCrmBeautyDashboard(primary,report,30,period)).events[0].customer_name,"Farmacia Report");
});
test("query errors propagate instead of displaying false zero totals",async()=>{
 const {primary,report}=sources({error:new Error("database unavailable")});
 await assert.rejects(loadCrmBeautyDashboard(primary,report,30,period),/database unavailable/);
});
test("empty authorized mappings never query the privileged report source",async()=>{
 const report={from(){throw new Error("unauthorized request")}};
 assert.deepEqual((await loadCrmBeautyDashboard(database({beauty_clienti_mexal:[]}),report,30,period)).events,[]);
});
test("pagination includes more than 1000 orders",async()=>{
 const {primary,report}=sources({extraOrders:Array.from({length:1201},(_,i)=>order("extra-"+i,"2026-06-05",1))});
 assert.equal((await loadCrmBeautyDashboard(primary,report,30,period)).events[0].period_order_value,1261);
});
test("customer panel retains historical mode and invoice fields",async()=>{
 const {primary,report}=sources();
 const result=await loadCrmBeautyCustomer(primary,report,"A",30);
 assert.equal(result.period,null);
 assert.equal(result.events.length,3);
 assert.ok(result.events.every(e=>"invoice_value" in e.impact));
});
test("readAllRows fails on a later page, not partial success",async()=>{
 let pages=0;
 await assert.rejects(readAllRows(()=>({range:async()=>++pages===1?{data:[1,2]}:{error:new Error("page failed")}}),2),/page failed/);
});
test("UI sends period, cancels stale results and uses names, orders, compact columns",()=>{
 const ui=read("src/modules/crm/CrmBeautyDays.jsx");
 assert.match(ui,/from: period.from, to: period.to/);
 assert.match(ui,/if \(!cancelled\) setData/);
 assert.match(ui,/beautyMetric: null/);
 const table=read("src/modules/crm/CrmBeautyEventTable.jsx");
 assert.match(table,/event.customer_name/);
 assert.doesNotMatch(table,/\{event.customer_code\}<\/|impact\?\.invoice_value/);
 assert.match(table,/customerCode=\{event.customer_code\}/);
 assert.match(table,/Ordinato nel periodo/);
 assert.match(table,/impact\?\.order_value/);
 assert.match(read("src/modules/crm/beauty.css"),/table-layout:fixed/);
});
