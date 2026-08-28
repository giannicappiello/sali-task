import test from "node:test";
import assert from "node:assert/strict";
import { createFormulaDemand } from "./workspacemes-v3-api.js";

test("il contratto formula invia a MES codice e quantità senza UDM articolo FP Mexal", () => {
  const demand = createFormulaDemand({
    component: {
      workspaceLineId: "00000000-0000-4000-8000-000000000001",
      articleCode: "FP120C",
      requiredQuantity: 125.5,
      unitOfMeasure: "MES_MANAGED",
    },
    sources: [{ order_line_id: "00000000-0000-4000-8000-000000000001", oct_revision: 4 }],
    requestId: "00000000-0000-4000-8000-000000000010",
  });

  assert.deepEqual(demand, {
    workspaceLineId: "00000000-0000-4000-8000-000000000001",
    fpCode: "FP120C",
    quantity: 125.5,
    octRevision: 4,
    rdpRevision: "00000000-0000-4000-8000-000000000010",
  });
  assert.equal(Object.hasOwn(demand, "unitOfMeasure"), false);
});
