import test from "node:test";
import assert from "node:assert/strict";
import { createProgremesProductionClient, validateV3PreviewResponse, V3_CONFIRM_PATH, V3_PREVIEW_PATH } from "./progremes-production-client.js";

test("client V3 usa HMAC e valida snapshot MP certificati", async () => {
  const calls=[];
  const preview={contractVersion:3,workspaceRdpExternalId:"00000000-0000-4000-8000-000000000001",externalId:"00000000-0000-4000-8000-000000000002",idempotencyKey:"v3:preview:1",formulaDemands:[]};
  const client=createProgremesProductionClient({env:{PROGREMES_URL:"https://mes.example.test",PROGREMES_INTEGRATION_SECRET:"secret",WORKSPACEMES_V3_PREVIEW_ENABLED:"true",WORKSPACEMES_V3_CONFIRM_ENABLED:"true"},fetchImpl:async(url,init)=>{
    calls.push({url:String(url),init});
    return {ok:true,json:async()=>String(url).endsWith(V3_PREVIEW_PATH)?{externalId:preview.externalId,status:"Ready",snapshotHash:"a".repeat(64),rowVersion:"AQ==",mutatesProduction:false,formulas:[{workspaceLineId:"00000000-0000-4000-8000-000000000004",fpCode:"FP01",quantity:1,unitOfMeasure:"KG",materials:[{articleCode:"MP01",unitOfMeasure:"KG",required:1,physical:2,committed:0,incoming:0,uncovered:0,certifiedHash:"b".repeat(64)}]}]}:{externalId:"00000000-0000-4000-8000-000000000003",status:"Completed",productionCreated:true,productionOrders:[{id:1,number:"Rdp01"}],materialCommitments:1,message:"ok"}};
  }});
  assert.equal(client.v3PreviewEnabled(),true);assert.equal(client.v3ConfirmationEnabled(),true);
  await client.previewV3(preview);
  const confirm={externalId:"00000000-0000-4000-8000-000000000003"};await client.confirmV3(preview.workspaceRdpExternalId,confirm);
  assert.equal(calls[0].url,`https://mes.example.test${V3_PREVIEW_PATH}`);
  assert.equal(calls[1].url,`https://mes.example.test${V3_CONFIRM_PATH(preview.workspaceRdpExternalId)}`);
  assert.ok(calls.every((call)=>call.init.headers["x-workspace-signature"]));
});

test("client V3 accetta UDM vuota soltanto per una formula MES bloccata", () => {
  const payload = { externalId: "00000000-0000-4000-8000-000000000002" };
  const blocked = {
    externalId: payload.externalId,
    status: "Blocked",
    snapshotHash: "a".repeat(64),
    mutatesProduction: false,
    formulas: [{
      workspaceLineId: "00000000-0000-4000-8000-000000000004",
      fpCode: "FP120C",
      quantity: 1,
      unitOfMeasure: "",
      blocker: "FORMULA_UOM_MISSING",
      materials: [{ articleCode: "FP120C", unitOfMeasure: "", required: 1, physical: 0,
        committed: 0, incoming: 0, uncovered: 0, blockCode: "FORMULA_UOM_MISSING", certifiedHash: "b".repeat(64) }],
    }],
  };
  assert.equal(validateV3PreviewResponse(blocked, payload), blocked);
  assert.throws(() => validateV3PreviewResponse({ ...blocked, formulas: [{ ...blocked.formulas[0], blocker: "" }] }, payload),
    (error) => error.code === "INVALID_MES_V3_RESPONSE");
});
