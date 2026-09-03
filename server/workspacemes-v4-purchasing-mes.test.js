import assert from "node:assert/strict";
import test from "node:test";
import { automaticPfLines, calculateWorkspaceV4PurchaseRequirements } from "./workspacemes-v4-purchasing-mes.js";

test("calcola cronologicamente giacenze, arrivi e lotto di riordino", () => {
  const rows = calculateWorkspaceV4PurchaseRequirements({ contractVersion: 4, generatedAt: "2026-08-30T10:00:00Z",
    stocks: [{ articleId: 1, availableQuantity: 40 }], existingPf: [],
    arrivals: [{ articleId: 1, expectedAt: "2026-09-20", residualQuantity: 30, supplierOrderNumber: "OF1", supplierId: 9, supplierName: "Fornitore" }],
    demands: [
      { productionOrderId: 1, productionOrderNumber: "RDP16", octReferences: "OC/2/427", requiredAt: "2026-09-10", priority: 1, articleId: 1, articleCode: "MP1", description: "Materia", unitOfMeasure: "KG", articleType: "MateriaPrima", quantity: 60, reorderLot: 25, leadTimeDays: 10 },
      { productionOrderId: 2, productionOrderNumber: "RDP17", octReferences: "OC/2/428", requiredAt: "2026-09-25", priority: 1, articleId: 1, articleCode: "MP1", description: "Materia", unitOfMeasure: "KG", articleType: "MateriaPrima", quantity: 20, reorderLot: 25, leadTimeDays: 10 },
    ] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].netRequirement, 20);
  assert.equal(rows[0].quantityToOrder, 25);
  assert.ok(["TO_ORDER", "ORDER_LATE"].includes(rows[0].status));
  assert.equal(rows[0].supplierId, 9);
  assert.equal(rows[0].octReferences, "OC/2/427, OC/2/428");
});

test("un PF esistente viene mostrato ma non incrementa la disponibilità", () => {
  const rows = calculateWorkspaceV4PurchaseRequirements({ contractVersion: 4, generatedAt: "2026-08-30T10:00:00Z", stocks: [], arrivals: [],
    existingPf: [{ articleId: 2, expectedAt: "2026-10-15", quantity: 100, documentNumber: "PF 1/10" }],
    demands: [{ productionOrderId: 3, productionOrderNumber: "RDP18", requiredAt: "2026-10-15", priority: 1, articleId: 2, articleCode: "PK1", description: "Packaging", unitOfMeasure: "PZ", articleType: "Packaging", quantity: 100, reorderLot: 0, leadTimeDays: 5 }] });
  assert.equal(rows[0].quantityToOrder, 100);
  assert.equal(rows[0].pfQuantity, 100);
  assert.equal(rows[0].pfDocuments, "PF 1/10");
});

test("la generazione automatica include solo fabbisogni entro 60 giorni e senza PF esistenti", () => {
  const lines = automaticPfLines([
    { articleId: 1, requiredAt: "2026-09-03", quantityToOrder: 10, pfDocuments: "", pfQuantity: 0 },
    { articleId: 2, requiredAt: "2026-11-02", quantityToOrder: 20, pfDocuments: "", pfQuantity: 0 },
    { articleId: 3, requiredAt: "2026-11-03", quantityToOrder: 30, pfDocuments: "", pfQuantity: 0 },
    { articleId: 4, requiredAt: "2026-09-20", quantityToOrder: 40, pfDocuments: "PF 4/1", pfQuantity: 40 },
    { articleId: 5, requiredAt: "2026-09-20", quantityToOrder: 0, pfDocuments: "", pfQuantity: 0 },
  ], { generatedAt: "2026-09-03T12:00:00Z", horizonDays: 60 });
  assert.deepEqual(lines, [
    { articleId: 1, quantity: 10, requiredAt: "2026-09-03" },
    { articleId: 2, quantity: 20, requiredAt: "2026-11-02" },
  ]);
});

test("la generazione automatica non duplica articolo e mese", () => {
  const lines = automaticPfLines([
    { articleId: 8, requiredAt: "2026-09-10", quantityToOrder: 10 },
    { articleId: 8, requiredAt: "2026-09-20", quantityToOrder: 15 },
  ], { generatedAt: "2026-09-03", horizonDays: 60 });
  assert.equal(lines.length, 1);
});
