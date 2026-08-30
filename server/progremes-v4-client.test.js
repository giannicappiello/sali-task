import test from "node:test";
import assert from "node:assert/strict";
import { createProgremesProductionClient, V4_CONFIRM_PATH, V4_PREVIEW_PATH } from "./progremes-production-client.js";

test("client V4 invia solo domanda PF e valida il netting completo MES", async () => {
  const requestId="00000000-0000-4000-8000-000000000001";
  const preview={contractVersion:4,workspaceRdpExternalId:requestId,externalId:"00000000-0000-4000-8000-000000000002",idempotencyKey:"v4:preview:1",demands:[{workspaceLineId:"00000000-0000-4000-8000-000000000004",finishedArticleCode:"CW0001",quantity:10,unitOfMeasure:"PZ",requiredAt:"2026-12-01T00:00:00Z"}]};
  const calls=[];
  const client=createProgremesProductionClient({env:{PROGREMES_URL:"https://mes.example.test",PROGREMES_INTEGRATION_SECRET:"secret",WORKSPACEMES_V4_PREVIEW_ENABLED:"true",WORKSPACEMES_V4_CONFIRM_ENABLED:"true"},fetchImpl:async(url,init)=>{
    calls.push({url:String(url),body:JSON.parse(init.body)});
    return {ok:true,json:async()=>String(url).endsWith(V4_PREVIEW_PATH)?{externalId:preview.externalId,status:"Ready",snapshotHash:"a".repeat(64),rowVersion:"1",mutatesProduction:false,demands:[{...preview.demands[0],materials:[{source:"DIRECT_COMPONENT",articleCode:"MP01",description:"Materia",unitOfMeasure:"KG",grossRequirement:2,physicalStock:5,committedQuantity:1,netStock:4,futureSupplyQuantity:0,projectedAvailability:4,shortageQuantity:0,availableAt:null,requiredAt:preview.demands[0].requiredAt,formulaVersionId:null,bomRevision:1,blockCode:"",certifiedHash:"b".repeat(64)}]}]}:{externalId:"00000000-0000-4000-8000-000000000003",status:"Confirmed",productionCreated:true,productionOrders:[{id:1,number:"OP1",articleCode:"CW0001",quantity:10,requiredAt:preview.demands[0].requiredAt}],commitmentsCreated:1,shortagesCreated:0,message:"ok"}};
  }});
  await client.previewV4(preview);
  await client.confirmV4(requestId,{externalId:"00000000-0000-4000-8000-000000000003"});
  assert.equal(calls[0].url,`https://mes.example.test${V4_PREVIEW_PATH}`);
  assert.equal(calls[1].url,`https://mes.example.test${V4_CONFIRM_PATH(requestId)}`);
  assert.deepEqual(Object.keys(calls[0].body.demands[0]).sort(),["finishedArticleCode","quantity","requiredAt","unitOfMeasure","workspaceLineId"].sort());
});

test("client V4 conserva codice e stato dei rifiuti MES privi di messaggio", async () => {
  const requestId = "00000000-0000-4000-8000-000000000001";
  const client = createProgremesProductionClient({
    env: {
      PROGREMES_URL: "https://mes.example.test",
      PROGREMES_INTEGRATION_SECRET: "secret",
      WORKSPACEMES_V4_CONFIRM_ENABLED: "true",
    },
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ code: "INVALID_SIGNATURE" }) }),
  });
  await assert.rejects(
    client.confirmV4(requestId, { externalId: "00000000-0000-4000-8000-000000000003" }),
    (error) => error.code === "INVALID_SIGNATURE"
      && error.status === 401
      && error.details?.upstreamStatus === 401
      && /INVALID_SIGNATURE/.test(error.message),
  );
});
