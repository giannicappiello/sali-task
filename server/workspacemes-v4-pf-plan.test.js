import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceV4PfPlan, workspaceV4PfPlanChecksum } from "./workspacemes-v4-pf-plan.js";

const suppliers = [
  { id: 7, codiceMexal: "601.00007", ragioneSociale: "Fornitore Test" },
  { id: 8, codiceMexal: "601.00008", ragioneSociale: "Fornitore Alternativo" },
];
const rows = [
  { key: "11:2026-09", month: "2026-09-01T00:00:00.000Z", articleId: 11, articleCode: "MP11", description: "Materia 11", unitOfMeasure: "KG", quantityToOrder: 12, requiredAt: "2026-09-20T00:00:00.000Z", supplierId: 7, pfDocuments: "", pfQuantity: 0 },
  { key: "12:2026-09", month: "2026-09-01T00:00:00.000Z", articleId: 12, articleCode: "MP12", description: "Materia 12", unitOfMeasure: "KG", quantityToOrder: 8, requiredAt: "2026-09-21T00:00:00.000Z", supplierId: 7, pfDocuments: "", pfQuantity: 0 },
];

test("il piano automatico selezionato contiene solo le righe richieste", () => {
  const plan = buildWorkspaceV4PfPlan(rows, suppliers, { mode: "automatic", selectedKeys: ["12:2026-09"], generatedAt: "2026-09-04T00:00:00.000Z", horizonDays: 60 });
  assert.equal(plan.documents.length, 1);
  assert.deepEqual(plan.documents[0].lines.map((line) => line.articleCode), ["MP12"]);
});

test("il piano da selezionati non applica il limite dei 60 giorni", () => {
  const future = { ...rows[1], key: "12:2027-02", month: "2027-02-01T00:00:00.000Z", requiredAt: "2027-02-21T00:00:00.000Z" };
  const plan = buildWorkspaceV4PfPlan([rows[0], future], suppliers, { mode: "selected", selectedKeys: [future.key], generatedAt: "2026-09-04T00:00:00.000Z", horizonDays: 60 });
  assert.equal(plan.documents.length, 1);
  assert.deepEqual(plan.documents[0].lines.map((line) => line.articleCode), ["MP12"]);
});

test("il piano da selezionati richiede un fornitore solo quando manca il mapping automatico", () => {
  const withoutSupplier = { ...rows[0], supplierId: null };
  assert.throws(() => buildWorkspaceV4PfPlan([withoutSupplier], suppliers, { mode: "selected", selectedKeys: [withoutSupplier.key] }), /Seleziona un fornitore PF/);
  const plan = buildWorkspaceV4PfPlan([withoutSupplier], suppliers, { mode: "selected", selectedKeys: [withoutSupplier.key], supplierId: 7 });
  assert.equal(plan.documents[0].supplierId, 7);
  assert.equal(plan.documents[0].lines[0].articleCode, "MP11");
});

test("il piano da selezionati risolve il fornitore associato anche per nome univoco", () => {
  const staleId = { ...rows[0], supplierId: 999, supplierName: " Fornitore   Test " };
  const plan = buildWorkspaceV4PfPlan([staleId], suppliers, { mode: "selected", selectedKeys: [staleId.key] });
  assert.equal(plan.documents[0].supplierId, 7);
});

test("il piano automatico distingue l'assenza fornitore dall'assenza di fabbisogni", () => {
  const withoutSupplier = { ...rows[0], supplierId: null, supplierName: "" };
  assert.throws(
    () => buildWorkspaceV4PfPlan([withoutSupplier], suppliers, { mode: "automatic", generatedAt: "2026-09-04T00:00:00.000Z", horizonDays: 60 }),
    (error) => error.code === "PF_SUPPLIER_REQUIRED" && /fornitore associato/i.test(error.message),
  );
});

test("il piano automatico genera i PF validi e conta i materiali senza fornitore", () => {
  const withoutSupplier = { ...rows[1], supplierId: null, supplierName: "" };
  const plan = buildWorkspaceV4PfPlan([rows[0], withoutSupplier], suppliers, {
    mode: "automatic", generatedAt: "2026-09-04T00:00:00.000Z", horizonDays: 60,
  });
  assert.equal(plan.documents.length, 1);
  assert.deepEqual(plan.documents[0].lines.map((line) => line.articleCode), ["MP11"]);
  assert.equal(plan.skippedWithoutSupplier, 1);
});

test("senza scelta manuale crea un PF per il MES e per ogni fornitore Workspace associato", () => {
  const associated = { ...rows[0], workspaceSuppliers: [
    { id: 7, ragioneSociale: "Fornitore Test" },
    { id: 8, ragioneSociale: "Fornitore Alternativo" },
  ] };
  const plan = buildWorkspaceV4PfPlan([associated], suppliers, {
    mode: "selected", selectedKeys: [associated.key], generatedAt: "2026-09-04T00:00:00.000Z",
  });
  assert.deepEqual(plan.documents.map((item) => item.supplierId), [7, 8]);
  assert.ok(plan.documents.every((item) => item.lines[0].articleCode === "MP11"));
});

test("anagrafiche duplicate dello stesso fornitore producono un solo PF", () => {
  const duplicateSuppliers = [
    ...suppliers,
    { ...suppliers[0], id: 70, ragioneSociale: "  FORNITORE   TEST " },
  ];
  const associated = { ...rows[0], workspaceSuppliers: [
    { id: 7, ragioneSociale: "Fornitore Test" },
    { id: 70, ragioneSociale: "Fornitore Test" },
  ] };
  const plan = buildWorkspaceV4PfPlan([associated], duplicateSuppliers, {
    mode: "selected", selectedKeys: [associated.key],
  });
  assert.equal(plan.documents.length, 1);
  assert.equal(plan.documents[0].supplierId, 7);
});

test("varianti societarie Comprof e Miluet non duplicano i PF", () => {
  const duplicateSuppliers = [
    { id: 21, codiceMexal: "601.00021", ragioneSociale: "COMPROF MILANO S.R.L.", partitaIva: "IT 012.345.67890" },
    { id: 22, codiceMexal: "601.00921", ragioneSociale: "Comprof Milano srl", codiceFiscale: "01234567890" },
    { id: 31, codiceMexal: "601.00031", ragioneSociale: "MILUET S.P.A." },
    { id: 32, codiceMexal: "601.00931", ragioneSociale: "Miluet" },
  ];
  const comprof = { ...rows[0], supplierId: 21, workspaceSuppliers: [{ id: 22, ragioneSociale: "Comprof Milano srl" }] };
  const miluet = { ...rows[1], supplierId: 31, workspaceSuppliers: [{ id: 32, ragioneSociale: "Miluet" }] };
  const plan = buildWorkspaceV4PfPlan([comprof, miluet], duplicateSuppliers, {
    mode: "selected", selectedKeys: [comprof.key, miluet.key],
  });
  assert.deepEqual(plan.documents.map((item) => item.supplierName), ["COMPROF MILANO S.R.L.", "MILUET S.P.A."]);
});

test("i fabbisogni di mesi diversi producono un solo PF per fornitore", () => {
  const october = {
    ...rows[1], key: "12:2026-10", month: "2026-10-01T00:00:00.000Z",
    requiredAt: "2026-10-12T00:00:00.000Z",
  };
  const plan = buildWorkspaceV4PfPlan([rows[0], october], suppliers, {
    mode: "automatic", generatedAt: "2026-09-04T00:00:00.000Z", horizonDays: 60,
  });
  assert.equal(plan.documents.length, 1);
  assert.equal(plan.documents[0].month, "2026-09-01T00:00:00.000Z");
  assert.deepEqual(plan.documents[0].lines.map((item) => item.articleCode), ["MP11", "MP12"]);
});

test("il fornitore manuale produce un solo PF anche con più associazioni Workspace", () => {
  const associated = { ...rows[0], workspaceSuppliers: [{ id: 8, ragioneSociale: "Fornitore Alternativo" }] };
  const plan = buildWorkspaceV4PfPlan([associated], suppliers, {
    mode: "selected", selectedKeys: [associated.key], supplierId: 8,
  });
  assert.deepEqual(plan.documents.map((item) => item.supplierId), [8]);
});

test("un'associazione Workspace copre un articolo privo di suggerimento MES", () => {
  const associated = { ...rows[0], supplierId: null, supplierName: "", workspaceSuppliers: [{ id: 8, ragioneSociale: "Fornitore Alternativo" }] };
  const plan = buildWorkspaceV4PfPlan([associated], suppliers, {
    mode: "automatic", generatedAt: "2026-09-04T00:00:00.000Z", horizonDays: 60,
  });
  assert.equal(plan.documents[0].supplierId, 8);
  assert.equal(plan.skippedWithoutSupplier, 0);
});

test("il piano da selezionati non ripropone righe con PF esistente", () => {
  const withPf = { ...rows[0], pfDocuments: "PF 1/1", pfQuantity: 12 };
  assert.throws(() => buildWorkspaceV4PfPlan([withPf], suppliers, { mode: "selected", selectedKeys: [withPf.key] }), /Nessun nuovo PF da generare per i materiali selezionati/);
});

test("il piano manuale conserva fornitore e mese e produce un hash stabile", () => {
  const options = { mode: "manual", supplierId: 7, month: "2026-09-01T00:00:00.000Z", selectedKeys: rows.map((row) => row.key) };
  const first = buildWorkspaceV4PfPlan(rows, suppliers, options);
  const second = buildWorkspaceV4PfPlan(rows, suppliers, options);
  assert.equal(first.documents[0].supplierCode, "601.00007");
  assert.equal(first.documents[0].lines.length, 2);
  assert.equal(workspaceV4PfPlanChecksum(first), workspaceV4PfPlanChecksum(second));
});
