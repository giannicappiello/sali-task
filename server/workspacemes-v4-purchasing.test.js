import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkspaceV4PurchaseDocument } from "./workspacemes-v4-purchasing.js";

test("la catena acquisti V4 richiede fornitore, quantità e lineage", () => {
  const rfq = validateWorkspaceV4PurchaseDocument({ documentType: "RFQ", supplierExternalRef: "F001", lines: [{ requirementId: 1, quantity: 10 }] });
  assert.equal(rfq.documentType, "RFQ");
  assert.equal(rfq.parentDocumentId, null);
  assert.throws(() => validateWorkspaceV4PurchaseDocument({ documentType: "QUOTE", supplierExternalRef: "F001", lines: [{ requirementId: 1, quantity: 10 }] }), /padre/);
  assert.throws(() => validateWorkspaceV4PurchaseDocument({ documentType: "RFQ", supplierExternalRef: "", lines: [{ requirementId: 1, quantity: 10 }] }), /Fornitore/);
});
