import assert from "node:assert/strict";
import test from "node:test";
import { calculateSaliDiIschiaProposal, SALI_DI_ISCHIA_RULES } from "./sali-di-ischia-proposal.js";

test("calcola il riassortimento Sali di Ischia interamente in Workspace", () => {
  const result = calculateSaliDiIschiaProposal({
    now: new Date("2026-08-31T10:00:00Z"),
    products: [{ codice_articolo: "IT100", descrizione: "Prodotto", unita_misura: "PZ", dati_mexal: {} }],
    settings: [{ article_code: "IT100", lead_time_days: 60, enabled: true }],
    stocks: [{ article_code: "IT100", available: 5 }],
    sales: [
      { articleCode: "IT100", quantity: 120, date: "2026-02-01" },
      { articleCode: "IT100", quantity: 240, date: "2025-02-01" },
    ],
  });
  assert.equal(SALI_DI_ISCHIA_RULES.warehouseNumber, 5);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].estimatedMonthlyConsumption, 20);
  assert.equal(result.lines[0].replenishmentRequirement, 40);
  assert.equal(result.lines[0].proposedQuantity, 35);
  assert.equal(result.lines[0].requiredAt, "2026-10-30");
});

test("non propone articoli coperti dalla giacenza o esclusi", () => {
  const result = calculateSaliDiIschiaProposal({
    now: new Date("2026-08-31T10:00:00Z"),
    products: [
      { codice_articolo: "IT100", dati_mexal: {} },
      { codice_articolo: "IT200", dati_mexal: {} },
      { codice_articolo: "CW100", dati_mexal: {} },
    ],
    settings: [{ article_code: "IT200", enabled: false }],
    stocks: [{ article_code: "IT100", available: 100 }],
    sales: [
      { articleCode: "IT100", quantity: 120, date: "2026-02-01" },
      { articleCode: "IT200", quantity: 120, date: "2026-02-01" },
      { articleCode: "CW100", quantity: 120, date: "2026-02-01" },
    ],
  });
  assert.deepEqual(result.lines, []);
});
