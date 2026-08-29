import test from "node:test";
import assert from "node:assert/strict";
import { createFormulaDemand, createPreviewRecalculationIdentity, formulaPreviewBlocker } from "./workspacemes-v3-api.js";

test("il contratto formula invia prodotto finito, codice FP e quantità senza UDM FP Mexal", () => {
  const demand = createFormulaDemand({
    component: {
      workspaceLineId: "00000000-0000-4000-8000-000000000001",
      articleCode: "FP120C",
      requiredQuantity: 125.5,
      unitOfMeasure: "MES_MANAGED",
    },
    sources: [{ order_line_id: "00000000-0000-4000-8000-000000000001", finished_article_code: "CW0001", oct_revision: 4 }],
    requestId: "00000000-0000-4000-8000-000000000010",
  });

  assert.deepEqual(demand, {
    workspaceLineId: "00000000-0000-4000-8000-000000000001",
    finishedArticleCode: "CW0001",
    fpCode: "FP120C",
    quantity: 125.5,
    octRevision: 4,
    rdpRevision: "00000000-0000-4000-8000-000000000010",
  });
  assert.equal(Object.hasOwn(demand, "unitOfMeasure"), false);
});

test("ogni ricalcolo volontario usa una nuova preview, mentre il retry dello stesso tentativo resta idempotente", () => {
  const input = { requestId: "rdp-15", octHash: "oct", bomHash: "bom", availabilityVersion: "stock" };
  const first = createPreviewRecalculationIdentity({ ...input, previewAttemptId: "attempt-1" });
  const retry = createPreviewRecalculationIdentity({ ...input, previewAttemptId: "attempt-1" });
  const recalculation = createPreviewRecalculationIdentity({ ...input, previewAttemptId: "attempt-2" });

  assert.deepEqual(retry, first);
  assert.notDeepEqual(recalculation, first);
});

test("una formula MES presente senza blocker è pronta e non diventa preview mancante", () => {
  assert.equal(formulaPreviewBlocker({ blocker: "" }), null);
  assert.equal(formulaPreviewBlocker({ blocker: null }), null);
  assert.equal(formulaPreviewBlocker({ blocker: "MATERIAL_MAPPING_MISSING" }), "MATERIAL_MAPPING_MISSING");
  assert.equal(formulaPreviewBlocker(null), "MES_FORMULA_PREVIEW_MISSING");
});
