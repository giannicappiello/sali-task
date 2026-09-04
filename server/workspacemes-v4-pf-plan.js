import { createHash } from "node:crypto";
import { automaticPfRows } from "./workspacemes-v4-purchasing-mes.js";

const clean = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const monthKey = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};
const fail = (message, code = "PF_PREVIEW_INVALID") => { throw Object.assign(new Error(message), { status: 400, code }); };

function line(row) {
  return { key: clean(row.key), articleId: Number(row.articleId), articleCode: clean(row.articleCode),
    description: clean(row.description), unitOfMeasure: clean(row.unitOfMeasure),
    quantity: number(row.quantityToOrder), requiredAt: row.requiredAt };
}

function supplierMap(suppliers) {
  return new Map((suppliers || []).map((supplier) => [Number(supplier.id), supplier]));
}

function document(supplier, supplierId, month, rows) {
  return { supplierId, supplierCode: clean(supplier?.codiceMexal), supplierName: clean(supplier?.ragioneSociale) || `Fornitore ${supplierId}`,
    supplierVatNumber: clean(supplier?.partitaIva), supplierTaxCode: clean(supplier?.codiceFiscale),
    supplierAddress: clean(supplier?.indirizzo), supplierPostalCode: clean(supplier?.cap),
    supplierCity: clean(supplier?.localita), supplierProvince: clean(supplier?.provincia), supplierPhone: clean(supplier?.telefono),
    month: `${month}-01T00:00:00.000Z`, lines: rows.map(line).sort((a, b) => a.articleCode.localeCompare(b.articleCode)) };
}

export function buildWorkspaceV4PfPlan(requirements, suppliers, options = {}) {
  const mode = clean(options.mode).toLowerCase();
  if (!["manual", "automatic"].includes(mode)) fail("Modalità di anteprima PF non valida.");
  const selectedKeys = Array.isArray(options.selectedKeys)
    ? new Set(options.selectedKeys.slice(0, 2000).map(clean).filter(Boolean))
    : null;
  let rows = (requirements || []).filter((row) => number(row.quantityToOrder) > 0);
  if (selectedKeys) rows = rows.filter((row) => selectedKeys.has(clean(row.key)));
  if (selectedKeys && !selectedKeys.size) fail("Seleziona almeno un materiale da ordinare.");
  const suppliersById = supplierMap(suppliers);

  if (mode === "manual") {
    const supplierId = Number(options.supplierId);
    const month = monthKey(options.month);
    if (!Number.isSafeInteger(supplierId) || supplierId < 1 || !month) fail("Fornitore e mese sono obbligatori per il PF manuale.");
    if (!suppliersById.has(supplierId)) fail("Il fornitore selezionato non è disponibile.");
    rows = rows.filter((row) => monthKey(row.month || row.requiredAt) === month);
    if (!rows.length) fail("Nessun materiale selezionato è disponibile per il PF manuale.");
    return { mode, documents: [document(suppliersById.get(supplierId), supplierId, month, rows)], skippedWithoutSupplier: 0 };
  }

  const eligible = automaticPfRows(rows, { generatedAt: options.generatedAt, horizonDays: options.horizonDays ?? 60 });
  const skippedWithoutSupplier = eligible.filter((row) => !Number.isSafeInteger(Number(row.supplierId)) || Number(row.supplierId) < 1).length;
  const groups = new Map();
  for (const row of eligible) {
    const supplierId = Number(row.supplierId);
    const month = monthKey(row.month || row.requiredAt);
    if (!Number.isSafeInteger(supplierId) || supplierId < 1 || !month || !suppliersById.has(supplierId)) continue;
    const key = `${supplierId}:${month}`;
    if (!groups.has(key)) groups.set(key, { supplierId, month, rows: [] });
    groups.get(key).rows.push(row);
  }
  const documents = [...groups.values()].sort((a, b) => a.month.localeCompare(b.month) || a.supplierId - b.supplierId)
    .map((group) => document(suppliersById.get(group.supplierId), group.supplierId, group.month, group.rows));
  if (!documents.length) fail("Nessun nuovo PF da generare nei prossimi 60 giorni.", "PF_PREVIEW_EMPTY");
  return { mode, documents, skippedWithoutSupplier };
}

export function workspaceV4PfPlanChecksum(plan) {
  const canonical = (plan?.documents || []).map((item) => ({ supplierId: item.supplierId, month: item.month,
    lines: item.lines.map(({ key, articleId, quantity, requiredAt }) => ({ key, articleId, quantity, requiredAt })) }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
