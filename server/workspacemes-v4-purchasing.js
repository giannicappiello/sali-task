import { randomUUID } from "node:crypto";
import { payloadHash } from "./workspacemes-v3.js";

const TYPES = new Set(["RFQ", "QUOTE", "SUPPLIER_ORDER"]);
const clean = (value) => String(value ?? "").trim();
// Versionare la sorgente forza una rilettura dopo l'ampliamento dello storico
// alle righe Mexal valide non ancora collegate a un ArticoloId interno MES.
export const AUTOMATIC_ARTICLE_SUPPLIER_SOURCE = "PROGREMES_ORDER_HISTORY_V3";

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

export async function listWorkspaceArticleSupplierAssociations({ admin }) {
  const { data, error } = await admin.from("workspace_article_supplier_associations")
    .select("id,article_id,article_code,supplier_id,supplier_code,supplier_name,source,last_order_at,order_count,created_at,updated_at")
    .order("last_order_at", { ascending: false, nullsFirst: false })
    .order("supplier_name");
  if (error) throw error;
  return data || [];
}

const upper = (value) => clean(value).toUpperCase();

export async function synchronizeWorkspaceArticleSupplierAssociations({
  admin, relationships, articles, suppliers, source = AUTOMATIC_ARTICLE_SUPPLIER_SOURCE,
}) {
  const articleByCode = new Map();
  for (const article of articles || []) {
    for (const code of [article?.codice, article?.codiceMexal]) {
      const normalized = upper(code);
      if (normalized && !articleByCode.has(normalized)) articleByCode.set(normalized, article);
    }
  }
  const supplierByCode = new Map((suppliers || []).map((supplier) => [upper(supplier?.codiceMexal), supplier]));
  const rows = new Map();
  const seenAt = new Date().toISOString();
  for (const relationship of relationships || []) {
    const article = articleByCode.get(upper(relationship?.articleCode));
    const supplier = supplierByCode.get(upper(relationship?.supplierCode));
    const articleId = Number(article?.id);
    const supplierId = Number(supplier?.id);
    if (!Number.isSafeInteger(articleId) || articleId < 1 || !Number.isSafeInteger(supplierId) || supplierId < 1) continue;
    rows.set(`${articleId}:${supplierId}`, {
      article_id: articleId,
      article_code: clean(article.codice) || clean(article.codiceMexal),
      supplier_id: supplierId,
      supplier_code: clean(supplier.codiceMexal),
      supplier_name: clean(supplier.ragioneSociale) || `Fornitore ${supplierId}`,
      source,
      last_order_at: clean(relationship?.lastOrderAt) || null,
      order_count: Math.max(1, Number(relationship?.orderCount) || 1),
      source_seen_at: seenAt,
      updated_at: seenAt,
    });
  }
  if (!rows.size) return { matched: 0, received: relationships?.length || 0 };
  const { error } = await admin.from("workspace_article_supplier_associations")
    .upsert([...rows.values()], { onConflict: "article_id,supplier_id" });
  if (error) throw error;
  return { matched: rows.size, received: relationships?.length || 0 };
}

export async function workspaceArticleSupplierHistoryNeedsRefresh({ admin, now = new Date(), maximumAgeHours = 12 }) {
  const { data, error } = await admin.from("workspace_article_supplier_sync_state")
    .select("status,last_completed_at").eq("source", AUTOMATIC_ARTICLE_SUPPLIER_SOURCE).maybeSingle();
  if (error) throw error;
  if (data?.status !== "COMPLETED" || !data.last_completed_at) return true;
  return now.getTime() - new Date(data.last_completed_at).getTime() >= maximumAgeHours * 60 * 60 * 1000;
}

export async function recordWorkspaceArticleSupplierSync({ admin, status, count = 0, error = null }) {
  const now = new Date().toISOString();
  const row = {
    source: AUTOMATIC_ARTICLE_SUPPLIER_SOURCE,
    status,
    relationship_count: Math.max(0, Number(count) || 0),
    last_error: error ? clean(error).slice(0, 1000) : null,
    updated_at: now,
  };
  if (status === "RUNNING") row.last_started_at = now;
  if (status === "COMPLETED") row.last_completed_at = now;
  const { error: saveError } = await admin.from("workspace_article_supplier_sync_state")
    .upsert(row, { onConflict: "source" });
  if (saveError) throw saveError;
}

export function attachWorkspaceArticleSuppliers(requirements = [], associations = []) {
  const byArticle = new Map();
  for (const item of associations || []) {
    const articleId = Number(item.article_id);
    if (!Number.isSafeInteger(articleId) || articleId < 1) continue;
    byArticle.set(articleId, [...(byArticle.get(articleId) || []), {
      associationId: Number(item.id), id: Number(item.supplier_id), codiceMexal: clean(item.supplier_code),
      ragioneSociale: clean(item.supplier_name),
    }]);
  }
  return (requirements || []).map((row) => ({ ...row, workspaceSuppliers: byArticle.get(Number(row.articleId)) || [] }));
}

export async function addWorkspaceArticleSupplierAssociations({ admin, articles, supplier, actor }) {
  const supplierId = Number(supplier?.id);
  if (!Number.isSafeInteger(supplierId) || supplierId < 1) throw Object.assign(new Error("Fornitore non valido."), { status: 400 });
  const unique = new Map();
  for (const item of Array.isArray(articles) ? articles.slice(0, 2000) : []) {
    const articleId = Number(item?.articleId);
    const articleCode = clean(item?.articleCode);
    if (Number.isSafeInteger(articleId) && articleId > 0 && articleCode) unique.set(articleId, { articleId, articleCode });
  }
  if (!unique.size) throw Object.assign(new Error("Seleziona almeno un articolo da associare."), { status: 400 });
  const now = new Date().toISOString();
  const rows = [...unique.values()].map((item) => ({
    article_id: item.articleId, article_code: item.articleCode, supplier_id: supplierId,
    supplier_code: clean(supplier.codiceMexal), supplier_name: clean(supplier.ragioneSociale) || `Fornitore ${supplierId}`,
    source: "MANUAL", source_seen_at: now,
    created_by: actor || null, updated_by: actor || null, updated_at: now,
  }));
  const { data, error } = await admin.from("workspace_article_supplier_associations")
    .upsert(rows, { onConflict: "article_id,supplier_id" }).select("id");
  if (error) throw error;
  return { message: `Fornitore associato a ${unique.size} articoli.`, associations: data || [] };
}

export async function removeWorkspaceArticleSupplierAssociation({ admin, associationId }) {
  const id = Number(associationId);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error("Associazione articolo-fornitore non valida."), { status: 400 });
  const { data, error } = await admin.from("workspace_article_supplier_associations").delete().eq("id", id).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("Associazione articolo-fornitore non trovata."), { status: 404 });
  return { message: "Associazione articolo-fornitore rimossa." };
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
