import assert from "node:assert/strict";
import test from "node:test";
import { calculateWorkspaceV4PurchaseRequirements } from "./workspacemes-v4-purchasing-mes.js";

test("calcola cronologicamente giacenze, arrivi e lotto di riordino", () => {
  const rows = calculateWorkspaceV4PurchaseRequirements({ contractVersion: 4, generatedAt: "2026-08-30T10:00:00Z",
    stocks: [{ articleId: 1, availableQuantity: 40 }], existingPf: [],
    arrivals: [{ articleId: 1, expectedAt: "2026-09-20", residualQuantity: 30, supplierOrderNumber: "OF1", supplierId: 9, supplierName: "Fornitore" }],
    demands: [
      { productionOrderId: 1, productionOrderNumber: "RDP16", requiredAt: "2026-09-10", priority: 1, articleId: 1, articleCode: "MP1", description: "Materia", unitOfMeasure: "KG", articleType: "MateriaPrima", quantity: 60, reorderLot: 25, leadTimeDays: 10 },
      { productionOrderId: 2, productionOrderNumber: "RDP17", requiredAt: "2026-09-25", priority: 1, articleId: 1, articleCode: "MP1", description: "Materia", unitOfMeasure: "KG", articleType: "MateriaPrima", quantity: 20, reorderLot: 25, leadTimeDays: 10 },
    ] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].netRequirement, 20);
  assert.equal(rows[0].quantityToOrder, 25);
  assert.equal(rows[0].status, "TO_ORDER");
  assert.equal(rows[0].supplierId, 9);
});

test("un PF esistente viene mostrato ma non incrementa la disponibilità", () => {
  const rows = calculateWorkspaceV4PurchaseRequirements({ contractVersion: 4, generatedAt: "2026-08-30T10:00:00Z", stocks: [], arrivals: [],
    existingPf: [{ articleId: 2, expectedAt: "2026-10-15", quantity: 100, documentNumber: "PF 1/10" }],
    demands: [{ productionOrderId: 3, productionOrderNumber: "RDP18", requiredAt: "2026-10-15", priority: 1, articleId: 2, articleCode: "PK1", description: "Packaging", unitOfMeasure: "PZ", articleType: "Packaging", quantity: 100, reorderLot: 0, leadTimeDays: 5 }] });
  assert.equal(rows[0].quantityToOrder, 100);
  assert.equal(rows[0].pfQuantity, 100);
  assert.equal(rows[0].pfDocuments, "PF 1/10");
});
