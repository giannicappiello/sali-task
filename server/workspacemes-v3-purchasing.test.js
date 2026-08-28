import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceV3PurchaseDocument, validatePurchaseDocument } from "./workspacemes-v3-purchasing.js";

test("workflow acquisti V3 richiede lineage e fornitore senza inviare a Mexal", async () => {
  assert.throws(() => validatePurchaseDocument({ documentType: "QUOTE", lines: [{ requirementId: 1, quantity: 2 }] }), /padre/i);
  assert.throws(() => validatePurchaseDocument({ documentType: "QUOTE", parentDocumentId: 4, lines: [{ requirementId: 1, quantity: 2 }] }), /fornitore/i);
  let args;
  const result = await createWorkspaceV3PurchaseDocument({
    admin: { rpc: async (name, values) => { args = { name, values }; return { data: [{ document_id: 9, document_type: "SUPPLIER_ORDER", status: "PREPARED", created: true }], error: null }; } },
    actor: "workspace:user",
    input: { documentType: "SUPPLIER_ORDER", parentDocumentId: 8, supplierExternalRef: "201.00001", lines: [{ requirementId: 1, quantity: 2, unitPrice: 3.5 }] },
  });
  assert.equal(args.name, "create_workspace_v3_purchase_document");
  assert.equal(args.values.p_document_type, "SUPPLIER_ORDER");
  assert.equal(result.sendToMexal, false);
});
