import { randomUUID } from "node:crypto";
import { payloadHash } from "./workspacemes-v3.js";

const TYPES = new Set(["RFQ", "QUOTE", "SUPPLIER_ORDER"]);
const clean = (value) => String(value ?? "").trim();

export function validateWorkspaceV4PurchaseDocument(input = {}) {
  const documentType = clean(input.documentType).toUpperCase();
  if (!TYPES.has(documentType)) throw Object.assign(new Error("Tipo documento acquisti V4 non valido."), { status: 400 });
  const parentDocumentId = input.parentDocumentId === null || input.parentDocumentId === undefined || input.parentDocumentId === ""
    ? null : Number(input.parentDocumentId);
  if (documentType === "RFQ" && parentDocumentId !== null)
    throw Object.assign(new Error("La richiesta preventivo non deve avere un documento padre."), { status: 400 });
  if (documentType !== "RFQ" && (!Number.isSafeInteger(parentDocumentId) || parentDocumentId < 1))
    throw Object.assign(new Error("Documento padre obbligatorio."), { status: 400 });
  if (!clean(input.supplierExternalRef)) throw Object.assign(new Error("Fornitore obbligatorio."), { status: 400 });
  const lines = Array.isArray(input.lines) ? input.lines.map((line) => ({
    requirementId: Number(line.requirementId), quantity: Number(line.quantity),
    unitPrice: line.unitPrice === null || line.unitPrice === undefined || line.unitPrice === "" ? null : Number(line.unitPrice),
    expectedAt: clean(line.expectedAt) || null,
  })) : [];
  if (!lines.length || lines.some((line) => !Number.isSafeInteger(line.requirementId) || line.requirementId < 1 ||
    !Number.isFinite(line.quantity) || line.quantity <= 0 ||
    (line.unitPrice !== null && (!Number.isFinite(line.unitPrice) || line.unitPrice < 0))))
    throw Object.assign(new Error("Righe acquisto V4 non valide."), { status: 400 });
  return {
    documentType, parentDocumentId, supplierExternalRef: clean(input.supplierExternalRef),
    supplierName: clean(input.supplierName) || null, documentNumber: clean(input.documentNumber) || null,
    currency: clean(input.currency).toUpperCase() || null, validUntil: clean(input.validUntil) || null, lines,
  };
}

export async function listWorkspaceV4Purchasing({ admin, suppliers = [] }) {
  const [requirementsResult, documentsResult, linesResult] = await Promise.all([
    admin.from("workspace_v4_purchase_requirements").select("*").neq("status", "CANCELLED").order("required_at"),
    admin.from("workspace_v4_purchase_documents").select("*").order("created_at", { ascending: false }).limit(500),
    admin.from("workspace_v4_purchase_document_lines").select("*").order("id").limit(2000),
  ]);
  const error = requirementsResult.error || documentsResult.error || linesResult.error;
  if (error) throw error;
  const linesByDocument = new Map();
  for (const line of linesResult.data || []) linesByDocument.set(line.document_id, [...(linesByDocument.get(line.document_id) || []), line]);
  return {
    requirements: requirementsResult.data || [],
    documents: (documentsResult.data || []).map((document) => ({ ...document, lines: linesByDocument.get(document.id) || [] })),
    suppliers: (suppliers || []).filter((supplier) => supplier?.attivo !== false),
  };
}

export async function createWorkspaceV4PurchaseDocument({ admin, input, actor }) {
  const command = validateWorkspaceV4PurchaseDocument(input);
  const idempotencyKey = clean(input.idempotencyKey) || `workspacemes:v4:purchase:${payloadHash(command)}`;
  const correlationId = clean(input.correlationId) || randomUUID();
  const { data, error } = await admin.rpc("create_workspace_v4_purchase_document", {
    p_external_id: randomUUID(), p_document_type: command.documentType,
    p_parent_document_id: command.parentDocumentId, p_supplier_external_ref: command.supplierExternalRef,
    p_supplier_name: command.supplierName, p_document_number: command.documentNumber,
    p_currency: command.currency, p_valid_until: command.validUntil, p_payload_hash: payloadHash(command),
    p_idempotency_key: idempotencyKey, p_correlation_id: correlationId,
    p_actor: actor || "workspace:service", p_lines: command.lines,
  });
  if (error) throw error;
  return { document: data?.[0] || null, sendToMexal: false };
}
