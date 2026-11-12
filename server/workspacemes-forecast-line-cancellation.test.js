import test from "node:test";
import assert from "node:assert/strict";
import { previewForecastLineCancellation, cancelForecastLine, cancelledForecastLineKeys, forecastLineKey } from "./workspacemes-forecast-line-cancellation.js";

const line = "54ecabe1-55f1-4378-85aa-bfc323594eb2";
function fixture() {
  const tables = {
    workspace_production_requests: [{id:"rdp",external_id:"external",contract_version:4,workspace_status:"CONFIRMED"}],
    workspace_production_request_items: [{production_request_id:"rdp",ordine_riga_id:line,ordine_id:"oc507"}],
    workspace_v4_previews: [{id:"preview",production_request_id:"rdp"}],
    workspace_v4_confirmation_mirrors: [{preview_id:"preview",external_id:"confirmation",status:"COMPLETED"}],
    workspace_production_request_audit: [],
  };
  const writes = []; let cancelCount=0;
  const admin = {from(table) {
    assert.ok(tables[table], table); let filters=[]; let single=false; let insert;
    const q = {select(){return q;},eq(k,v){filters.push(row=>row[k]===v);return q;},
      in(k,values){filters.push(row=>values.includes(row[k]));return q;},order(){return q;},single(){single=true;return q;},
      insert(value){assert.equal(table,"workspace_production_request_audit");insert=value;return q;},
      then(resolve,reject) {return Promise.resolve().then(()=>{
        if(insert){writes.push(insert);tables[table].push(insert);return {data:null};}
        const data=tables[table].filter(row=>filters.every(filter=>filter(row)));return {data:single?data[0]:data};
      }).then(resolve,reject);}
    };return q;
  },rpc(){assert.fail("No whole-request cancellation RPC");}};
  const forecast={demandId:781,workspaceLineId:line,number:"RDP271",articleCode:"FPDET01",quantity:15000,unit:"KG",octReference:"OC/2/507"};
  const preview={confirmationExternalId:"confirmation",workspaceLineId:line,stateHash:"a".repeat(64),allowed:true,
    cancelledOrders:[],preservedOrders:[{id:6481,number:"RDP271-05",status:"Completato"}],cancelledForecasts:[forecast],blocks:[]};
  const result={status:"CANCELLED",workspaceLineId:line,cancelledOrders:[],preservedOrders:preview.preservedOrders,cancelledForecasts:[forecast]};
  const client={previewCancellationV4:async(id,payload)=>{assert.equal(id,"external");assert.equal(payload.workspaceLineId,line);return {result:preview};},
    cancelV4:async(id,payload)=>{cancelCount++;assert.equal(payload.workspaceLineId,line);assert.equal(payload.expectedStateHash,preview.stateHash);return {result};}};
  const input={admin,client,requestId:"rdp",workspaceLineId:line,requestedBy:"actor",reason:"Solo residuo OC507",previews:[preview]};
  return {tables,writes,preview,result,client,input,cancelCount:()=>cancelCount};
}
test("only OC507 FPDET01 is cancelled: shared RdP header and completed OP are untouched",async()=>{
  const f=fixture();const before=JSON.stringify(f.tables.workspace_production_requests);
  const p=await previewForecastLineCancellation(f.input);
  assert.equal(p.allowed,true);assert.equal(f.writes.length,0);
  assert.equal(p.cancelledForecasts[0].articleCode,"FPDET01");assert.equal(p.preservedOrders[0].id,6481);
  const result=await cancelForecastLine(f.input);assert.equal(result.workspaceLineId,line);
  assert.deepEqual(f.writes.map(x=>x.action),["FORECAST_LINE_CANCELLATION_PENDING","FORECAST_LINE_CANCELLED"]);
  assert.equal(JSON.stringify(f.tables.workspace_production_requests),before);
  assert.deepEqual(await cancelForecastLine(f.input),result);assert.equal(f.cancelCount(),1);
  const keys=await cancelledForecastLineKeys(f.input.admin,["rdp"]);
  assert.equal(keys.has(forecastLineKey("rdp",line)),true);assert.equal(keys.has(forecastLineKey("rdp","another-line")),false);
});
test("older MES that ignores line scope is blocked before any cancellation",async()=>{
  const f=fixture();f.client.previewCancellationV4=async()=>({result:{...f.preview,workspaceLineId:undefined,cancelledForecasts:undefined}});
  await assert.rejects(cancelForecastLine(f.input),{code:"FORECAST_LINE_SCOPE_UNSUPPORTED"});
  assert.equal(f.cancelCount(),0);assert.equal(f.writes.length,0);
});
test("OP conversion, stale hash, wrong or duplicate line fail closed",async()=>{
  for(const kind of ["converted","stale","wrong","duplicate"]) {
    const f=fixture();
    if(kind==="converted")f.preview.allowed=false;
    if(kind==="stale")f.input.previews=[{...f.preview,stateHash:"b".repeat(64)}];
    if(kind==="wrong")f.input.workspaceLineId="00000000-0000-4000-8000-000000000001";
    if(kind==="duplicate")f.tables.workspace_production_request_items.push({...f.tables.workspace_production_request_items[0]});
    await assert.rejects(cancelForecastLine(f.input));assert.equal(f.cancelCount(),0);assert.equal(f.writes.length,0);
  }
});
test("unknown response is reconciled with the same line and actor, never the whole request",async()=>{
  const f=fixture();const cancel=f.client.cancelV4;let first=true;
  f.client.cancelV4=async(...args)=>{const r=await cancel(...args);if(first){first=false;throw new Error("timeout after MES commit");}return r;};
  await assert.rejects(cancelForecastLine(f.input),/timeout/);
  assert.equal(f.writes.length,1);
  f.input.requestedBy="other-actor";f.input.reason="different reason";
  const call=f.client.cancelV4;f.client.cancelV4=async(id,payload)=>{
    assert.equal(payload.cancelledBy,"workspace:actor");assert.equal(payload.reason,"Solo residuo OC507");return call(id,payload);
  };
  assert.deepEqual(await cancelForecastLine(f.input),f.result);assert.equal(f.cancelCount(),2);
});
test("multiple confirmations cannot widen the cancellation scope",async()=>{
  const f=fixture();f.tables.workspace_v4_confirmation_mirrors.push({preview_id:"preview",external_id:"other",status:"COMPLETED"});
  const read=f.client.previewCancellationV4;
  f.client.previewCancellationV4=async(id,payload)=>{
    if(payload.confirmationExternalId==="other")throw Object.assign(new Error("not this line"),{code:"V4_FORECAST_LINE_NOT_FOUND"});
    return read(id,payload);
  };
  assert.equal((await previewForecastLineCancellation(f.input)).previews.length,1);
  await cancelForecastLine(f.input);assert.equal(f.cancelCount(),1);
});


test("certain MES rollback clears only that attempt; uncertain outcomes stay pending",async()=>{
  const f=fixture();const original=f.client.cancelV4;
  f.client.cancelV4=async()=>{throw Object.assign(new Error("changed"),{status:400,code:"V4_CANCELLATION_STALE"});};
  await assert.rejects(cancelForecastLine(f.input),{code:"V4_CANCELLATION_STALE"});
  assert.deepEqual(f.writes.map(x=>x.action),["FORECAST_LINE_CANCELLATION_PENDING","FORECAST_LINE_CANCELLATION_REJECTED"]);
  f.client.cancelV4=original;
  await cancelForecastLine(f.input);
  assert.equal(f.writes.filter(x=>x.action==="FORECAST_LINE_CANCELLATION_PENDING").length,2);
});
