import { randomUUID } from "node:crypto";
import { payloadHash } from "./workspacemes-v3.js";

const TYPES = new Set(["PROPOSAL", "RFQ", "QUOTE", "SUPPLIER_ORDER"]);
const clean = (value) => String(value ?? "").trim();

export function validatePurchaseDocument(input = {}) {
  const documentType = clean(input.documentType).toUpperCase();
  if (!TYPES.has(documentType)) throw Object.assign(new Error("Tipo documento acquisti V3 non valido."), { status: 400 });
  const lines = Array.isArray(input.lines) ? input.lines.map((line) => ({
    requirementId: Number(line.requirementId), quantity: Number(line.quantity),
    unitPrice: line.unitPrice === null || line.unitPrice === undefined || line.unitPrice === "" ? null : Number(line.unitPrice),
    expectedAt: clean(line.expectedAt) || null,
  })) : [];
  if (!lines.length || lines.some((line) => !Number.isSafeInteger(line.requirementId) || line.requirementId < 1 ||
      !Number.isFinite(line.quantity) || line.quantity <= 0 || (line.unitPrice !== null && (!Number.isFinite(line.unitPrice) || line.unitPrice < 0))))
    throw Object.assign(new Error("Righe documento acquisti V3 non valide."), { status: 400 });
  const parentDocumentId = input.parentDocumentId === null || input.parentDocumentId === undefined ? null : Number(input.parentDocumentId);
  if (documentType !== "PROPOSAL" && (!Number.isSafeInteger(parentDocumentId) || parentDocumentId < 1))
    throw Object.assign(new Error("Documento padre acquisti V3 obbligatorio."), { status: 400 });
  if (["QUOTE", "SUPPLIER_ORDER"].includes(documentType) && !clean(input.supplierExternalRef))
    throw Object.assign(new Error("Fornitore obbligatorio per preventivo e ordine."), { status: 400 });
  return { documentType, parentDocumentId, supplierExternalRef: clean(input.supplierExternalRef) || null,
    documentNumber: clean(input.documentNumber) || null, currency: clean(input.currency).toUpperCase() || null,
    validUntil: clean(input.validUntil) || null, lines };
}

export async function createWorkspaceV3PurchaseDocument({ admin, input, actor }) {
  const command = validatePurchaseDocument(input);
  const idempotencyKey = clean(input.idempotencyKey) || `workspacemes:v3:purchase:${payloadHash(command)}`;
  const correlationId = clean(input.correlationId) || randomUUID();
  const { data, error } = await admin.rpc("create_workspace_v3_purchase_document", {
    p_external_id: randomUUID(), p_document_type: command.documentType, p_parent_document_id: command.parentDocumentId,
    p_supplier_external_ref: command.supplierExternalRef, p_document_number: command.documentNumber,
    p_currency: command.currency, p_valid_until: command.validUntil, p_payload_hash: payloadHash(command),
    p_idempotency_key: idempotencyKey, p_correlation_id: correlationId, p_actor: actor || "workspace:service",
    p_lines: command.lines,
  });
  if (error) throw error;
  return { document: data?.[0] || null, sendToMexal: false };
}
