/* global process */
import { Buffer } from "node:buffer";
import { privateDocumentOperation, synchronizeNas, rows } from "./private-documents-store.js";
import { createClient } from "@supabase/supabase-js";
import { productSpecificationOperation, specificationRequiresWrite } from "./product-specifications.js";

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
  if (upload && customerCodes.length) throw Object.assign(new Error("I clienti possono consultare i Documenti Private ma non associarli."), { status: 403 });

  if (upload && !isAdmin) {
    const [{ data: direct }, { data: role }] = await Promise.all([
      admin.from("permessi_utente").select("permessi!inner(codice)").eq("utente_id", profile.id)
        .eq("permessi.codice", "documentation.private.upload").limit(1).maybeSingle(),
      admin.from("permessi_ruolo").select("permessi!inner(codice)").eq("ruolo_id", profile.ruolo_id)
        .eq("permessi.codice", "documentation.private.upload").limit(1).maybeSingle(),
    ]);
    if (!direct && !role) throw Object.assign(new Error("Caricamento Documenti Private non autorizzato."), { status: 403 });
  }
  return { admin, user, profile, customerCodes: customerCodes.length ? customerCodes : ["*"], canWriteDocuments: upload };
}

export async function privateDocumentsSession(req, body = {}) {
  const identity = await authorize(req, { upload: body.upload === true });
  return { canUpload: body.upload === true, customerScoped: !identity.customerCodes.includes("*") };
}
export async function handlePrivateDocuments(req, body = {}) {
  const path = String(body.path || "");
  const pathname = new URL(path, "https://workspace.invalid/").pathname;
  const upload = ["/nas/sync", "/documents/reference", "/nas"].includes(pathname) || specificationRequiresWrite(pathname);
  const identity = await authorize(req, { upload });
  const result = pathname.startsWith("/specifications")
    ? await productSpecificationOperation(identity, path, body.input || {})
    : await privateDocumentOperation(identity, path, body.input || {});
  const url = new URL(path, "https://workspace.invalid/");
  if (url.searchParams.get("content") === "true" && ((pathname.startsWith("/documents/") && pathname !== "/documents/reference") || ["/specifications/file", "/specifications/preview"].includes(pathname))) {
    const offset = Number(url.searchParams.get("offset") || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw Object.assign(new Error("Posizione documento non valida."), { status: 400 });
    return readPrivateDocumentChunk(result.url, offset);
  }
  return result;
}

export async function readPrivateDocumentChunk(url, offset, fetchFile = fetch) {
  const chunkSize = 1024 * 1024;
  const response = await fetchFile(url, { headers: { Range: `bytes=${offset}-${offset + chunkSize - 1}` }, signal: AbortSignal.timeout(60000) });
  if (offset === 0 && response.status === 416 && response.headers.get("content-range") === "bytes */0") return { base64: "", nextOffset: null };
  if (!response.ok) throw new Error(`Lettura documento NAS non riuscita (${response.status}).`);
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") || "");
  if (response.status !== 206 || !range || Number(range[1]) !== offset || Number(range[2]) - offset + 1 > chunkSize)
    throw new Error("Risposta NAS incompleta: archivio ZIP non creato.");
  const reader = response.body.getReader(), chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length;
    if (length > chunkSize) { await reader.cancel(); throw new Error("Dimensione risposta NAS non valida."); }
    chunks.push(value);
  }
  if (length !== Number(range[2]) - offset + 1) throw new Error("Documento NAS incompleto: archivio ZIP non creato.");
  return { base64: Buffer.concat(chunks).toString("base64"), nextOffset: Number(range[2]) + 1 < Number(range[3]) ? Number(range[2]) + 1 : null };
}
export async function syncPrivateDocuments(req) {
  const {admin, customerCodes} = await authorize(req);
  if(!customerCodes.includes("*")) return {documents:0,slRows:0};
  await synchronizeNas(admin);
  const [documents,genealogy] = await Promise.all([rows(admin,"workspace_private_documents"),rows(admin,"workspace_sl_genealogy")]);
  return {documents:documents.filter(d=>d.attivo).length,slRows:genealogy.length};
}
