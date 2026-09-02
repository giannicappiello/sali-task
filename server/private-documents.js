/* global process, Buffer */
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw Object.assign(new Error(`Configurazione server mancante: ${name}`), { status: 500 });
  return value;
};

const adminClient = () => createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function authorize(req, { upload = false } = {}) {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sessione Workspace mancante."), { status: 401 });
  const admin = adminClient();
  const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7));
  if (authError || !user) throw Object.assign(new Error("Sessione Workspace non valida."), { status: 401 });
  const { data: profile, error: profileError } = await admin.from("utenti")
    .select("id,email,attivo,ruolo_id,ruoli(nome,livello_accesso,amministratore_workspace)")
    .eq("auth_user_id", user.id).maybeSingle();
  if (profileError || !profile || profile.attivo === false) throw Object.assign(new Error("Utente Workspace non abilitato."), { status: 403 });

  const isAdmin = profile.ruoli?.amministratore_workspace === true || profile.ruoli?.livello_accesso === "amministrazione";
  const { data: moduleEnabled, error: moduleError } = await admin.rpc("workspace_module_enabled_for_user", {
    target_user_id: profile.id, target_module: "progremes_formule",
  });
  if (moduleError) throw moduleError;
  if (!isAdmin && moduleEnabled !== true) throw Object.assign(new Error("Accesso a Documenti Private non autorizzato."), { status: 403 });

  if (upload && !isAdmin) {
    const [{ data: direct }, { data: role }] = await Promise.all([
      admin.from("permessi_utente").select("permessi!inner(codice)").eq("utente_id", profile.id)
        .eq("permessi.codice", "documentation.private.upload").limit(1).maybeSingle(),
      admin.from("permessi_ruolo").select("permessi!inner(codice)").eq("ruolo_id", profile.ruolo_id)
        .eq("permessi.codice", "documentation.private.upload").limit(1).maybeSingle(),
    ]);
    if (!direct && !role) throw Object.assign(new Error("Caricamento Documenti Private non autorizzato."), { status: 403 });
  }

  const [canonicalAccess, legacyAccess] = await Promise.all([
    admin.from("workspace_customer_user_links").select("customer_code").eq("user_id", profile.id),
    admin.from("workspace_private_document_customer_access").select("codice_cliente").eq("utente_id", profile.id),
  ]);
  if (canonicalAccess.error) throw canonicalAccess.error;
  if (legacyAccess.error) throw legacyAccess.error;
  const canonicalCodes = (canonicalAccess.data || []).map((row) => String(row.customer_code || "").trim()).filter(Boolean);
  const legacyCodes = (legacyAccess.data || []).map((row) => String(row.codice_cliente || "").trim()).filter(Boolean);
  const customerCodes = [...new Set(canonicalCodes.length ? canonicalCodes : legacyCodes)];
  const externalRole = /client|cliente|portal/i.test(String(profile.ruoli?.nome || ""));
  if (externalRole && customerCodes.length === 0) throw Object.assign(new Error("Nessun cliente associato all’account Workspace."), { status: 403 });
  return { admin, user, profile, customerCodes: customerCodes.length ? customerCodes : ["*"] };
}

export function createPrivateDocumentToken({ subject, email = "", operations = ["view"], customerCodes = ["*"], now = Math.floor(Date.now() / 1000) }, secret) {
  if (!subject || String(secret || "").length < 32) throw new Error("Identità o segreto Documenti Private non valido.");
  const encoded = Buffer.from(JSON.stringify({ subject, email, issuedAt: now, expiresAt: now + 600,
    operations, customerCodes })).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function issueToken(identity, operations) {
  return createPrivateDocumentToken({ subject: identity.profile.id,
    email: identity.profile.email || identity.user.email || "", operations, customerCodes: identity.customerCodes },
  required("PROGREMES_INTEGRATION_SECRET"));
}

function endpoint() { return new URL("/api/workspace/v1/private-documents/", required("PROGREMES_URL")).toString(); }

export async function privateDocumentsSession(req, body = {}) {
  const upload = body?.upload === true;
  const identity = await authorize(req, { upload });
  return { endpoint: endpoint(), token: issueToken(identity, upload ? ["view", "upload"] : ["view"]),
    expiresInSeconds: 600, canUpload: upload, customerScoped: !identity.customerCodes.includes("*") };
}

const documentRow = (row, now) => ({ external_id: row.externalId, tipo: row.type, titolo: row.title,
  revisione: row.revision, lingua: row.language, nome_file_originale: row.originalFileName,
  content_type: row.contentType, dimensione_byte: row.sizeBytes, valido_dal: row.validFrom,
  valido_al: row.validUntil, attivo: row.active, caricato_da: row.uploadedBy, caricato_il: row.uploadedAt,
  tipo_associazione: row.associationType, articolo_mes_id: row.articleId, giacenza_mes_id: row.stockLotId,
  ordine_produzione_mes_id: row.productionOrderId, produzione_mes_id: row.productionId,
  codice_lotto: row.lotCode, sincronizzato_il: now });

const genealogyRow = (row, now) => ({ mes_id: row.mesId, ordine_produzione_mes_id: row.productionOrderId,
  numero_ordine_produzione: row.productionOrderNumber, articolo_prodotto_mes_id: row.productArticleId,
  codice_articolo_prodotto: row.productArticleCode, lotto_destinazione: row.destinationLot,
  tipo_lotto_destinazione: row.destinationLotType, articolo_materia_prima_mes_id: row.rawMaterialArticleId,
  codice_articolo_materia_prima: row.rawMaterialArticleCode, descrizione_materia_prima: row.rawMaterialDescription,
  giacenza_origine_mes_id: row.sourceStockLotId, lotto_origine: row.sourceLot, quantita: row.quantity,
  unita_misura: row.unitOfMeasure, documento_sl: row.slDocument, registrata_il: row.registeredAt,
  riferimento_oct: row.octReference, riferimento_rdp: row.rdpReference, codice_cliente: row.customerCode,
  sincronizzato_il: now });

async function upsertChunks(admin, table, rows, onConflict) {
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await admin.from(table).upsert(rows.slice(index, index + 500), { onConflict });
    if (error) throw error;
  }
}

export async function syncPrivateDocuments(req) {
  const identity = await authorize(req);
  const response = await fetch(new URL("snapshot", endpoint()), { headers: {
    "X-Workspace-Secret": required("PROGREMES_INTEGRATION_SECRET"),
  }, signal: AbortSignal.timeout(30_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || `Sincronizzazione Documenti Private non riuscita (${response.status}).`), { status: 502 });
  const now = new Date().toISOString();
  const documents = Array.isArray(payload.documents) ? payload.documents.map((row) => documentRow(row, now)) : [];
  const genealogy = Array.isArray(payload.genealogy) ? payload.genealogy.map((row) => genealogyRow(row, now)) : [];
  await upsertChunks(identity.admin, "workspace_private_documents", documents, "external_id");
  await upsertChunks(identity.admin, "workspace_sl_genealogy", genealogy, "mes_id");
  return { syncedAt: now, documents: documents.length, slRows: genealogy.length };
}
