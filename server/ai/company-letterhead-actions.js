/* global Buffer, process */
import { createHash, randomUUID } from "node:crypto";
import { HMAC_HEADERS, signProductionMessage } from "../progremes-production-hmac.js";

export const HEADING_AI_TOOLS = Object.freeze({
  LIST_HEADINGS: { risk: "read_only", required: [] },
  GET_HEADING: { risk: "read_only", required: ["headingId"] },
  LIST_DOCUMENT_TYPES: { risk: "read_only", required: [] },
  LIST_HEADING_RULES: { risk: "read_only", required: [] },
  GET_DOCUMENT_HEADING: { risk: "read_only", required: ["documentTypeCode"] },
  PROPOSE_HEADING_RULE: { risk: "read_only", required: ["documentTypeCode", "letterheadId"] },
  CREATE_HEADING_RULE: { risk: "write", required: ["documentTypeCode", "letterheadId", "scope"] },
  UPDATE_HEADING_RULE: { risk: "write", required: ["ruleId", "letterheadId"] },
  DISABLE_HEADING_RULE: { risk: "write", required: ["ruleId"] },
  LIST_UNASSIGNED_DOCUMENT_TYPES: { risk: "read_only", required: [] },
  LIST_SIGNATURES: { risk: "read_only", required: [] },
  GET_SIGNATURE: { risk: "read_only", required: ["signatureId"] },
  ATTACH_SIGNATURE_TO_HEADING: { risk: "write", required: ["headingId", "signatureId", "placement"] },
  MES_DOCUMENT_GENERATE: { risk: "write", required: ["documentTypeCode", "targetId"] },
});

export const HEADING_TOOL_SCHEMAS = Object.freeze({
  LIST_HEADINGS: { type: "object", additionalProperties: false, properties: {} },
  GET_HEADING: { type: "object", additionalProperties: false, required: ["headingId"], properties: { headingId: { type: "string" } } },
  LIST_DOCUMENT_TYPES: { type: "object", additionalProperties: false, properties: {} },
  LIST_HEADING_RULES: { type: "object", additionalProperties: false, properties: { documentTypeCode: { type: "string" }, letterheadId: { type: "string" } } },
  GET_DOCUMENT_HEADING: { type: "object", additionalProperties: false, required: ["documentTypeCode"], properties: { documentTypeCode: { type: "string" }, brand: { type: "string" }, businessArea: { type: "string" }, language: { type: "string" } } },
  PROPOSE_HEADING_RULE: { type: "object", additionalProperties: false, required: ["documentTypeCode", "letterheadId"], properties: { documentTypeCode: { type: "string" }, letterheadId: { type: "string" }, scope: { type: "string" }, brand: { type: "string" }, businessArea: { type: "string" }, language: { type: "string" }, priority: { type: "integer" } } },
  CREATE_HEADING_RULE: { type: "object", additionalProperties: false, required: ["documentTypeCode", "letterheadId", "scope"], properties: { documentTypeCode: { type: "string" }, letterheadId: { type: "string" }, scope: { type: "string" }, brand: { type: "string" }, businessArea: { type: "string" }, language: { type: "string" }, priority: { type: "integer" }, validFrom: { type: "string" }, validTo: { type: "string" } } },
  UPDATE_HEADING_RULE: { type: "object", additionalProperties: false, required: ["ruleId", "letterheadId"], properties: { ruleId: { type: "string" }, documentTypeCode: { type: "string" }, letterheadId: { type: "string" }, scope: { type: "string" }, brand: { type: "string" }, businessArea: { type: "string" }, language: { type: "string" }, priority: { type: "integer" }, validFrom: { type: "string" }, validTo: { type: "string" } } },
  DISABLE_HEADING_RULE: { type: "object", additionalProperties: false, required: ["ruleId"], properties: { ruleId: { type: "string" } } },
  LIST_UNASSIGNED_DOCUMENT_TYPES: { type: "object", additionalProperties: false, properties: {} },
  LIST_SIGNATURES: { type: "object", additionalProperties: false, properties: {} },
  GET_SIGNATURE: { type: "object", additionalProperties: false, required: ["signatureId"], properties: { signatureId: { type: "string" } } },
  ATTACH_SIGNATURE_TO_HEADING: { type: "object", additionalProperties: false, required: ["headingId", "signatureId", "placement"], properties: { headingId: { type: "string" }, signatureId: { type: "string" }, placement: { type: "string", enum: ["header", "footer", "signature_block"] }, label: { type: "string" }, sortOrder: { type: "integer" } } },
  MES_DOCUMENT_GENERATE: { type: "object", additionalProperties: false, required: ["documentTypeCode", "targetId"], properties: { documentTypeCode: { type: "string", enum: ["CERTIFICATO_ANALISI"] }, targetId: { type: "string", description: "ID numerico della produzione MES" } } },
});

function normalized(value) {
  return String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function assertToolInput(tool, input) {
  const descriptor = HEADING_AI_TOOLS[tool];
  if (!descriptor) throw Object.assign(new Error("Strumento intestazioni non registrato."), { status: 400 });
  for (const field of descriptor.required) if (!String(input?.[field] || "").trim()) throw Object.assign(new Error(`Campo ${field} obbligatorio.`), { status: 400 });
  return descriptor;
}

async function listHeadings(scoped) {
  const { data, error } = await scoped.from("company_letterheads")
    .select("id,name,code,description,company_brand,kind,language,format,status,valid_from,valid_to,is_default,notes,created_at,updated_at,company_letterhead_versions(id,version,storage_path,original_filename,mime_type,size_bytes,sha256,valid_from,valid_to,created_at),document_letterhead_rules(id,document_type_code,scope,brand,business_area,language,priority,active,valid_from,valid_to)")
    .order("name");
  if (error) throw error;
  return data || [];
}

async function listDocumentTypes(scoped) {
  const { data, error } = await scoped.from("document_type_registry").select("code,name,description,system,module,category,active").eq("active", true).order("system").order("name");
  if (error) throw error;
  return data || [];
}

async function listSignatures(scoped) {
  const { data, error } = await scoped.from("company_signatures").select("id,name,code,signer_name,signer_role,description,status,valid_from,valid_to,notes,company_signature_versions(id,version,storage_path,original_filename,mime_type,size_bytes,sha256,valid_from,valid_to,created_at)").order("name");
  if (error) throw error;
  return data || [];
}

async function listRules(scoped, input = {}) {
  let query = scoped.from("document_letterhead_rules").select("id,document_type_code,letterhead_id,scope,brand,business_area,language,priority,active,valid_from,valid_to,created_at,updated_at,company_letterheads(name,code,company_brand,status)").order("priority", { ascending: false });
  if (input.documentTypeCode) query = query.eq("document_type_code", String(input.documentTypeCode).toUpperCase());
  if (input.letterheadId) query = query.eq("letterhead_id", input.letterheadId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function executeReadHeadingTool(auth, tool, input = {}) {
  assertToolInput(tool, input);
  if (tool === "LIST_HEADINGS") return { headings: await listHeadings(auth.scoped) };
  if (tool === "GET_HEADING") return { heading: (await listHeadings(auth.scoped)).find((item) => item.id === input.headingId) || null };
  if (tool === "LIST_DOCUMENT_TYPES") return { documentTypes: await listDocumentTypes(auth.scoped) };
  if (tool === "LIST_HEADING_RULES") return { rules: await listRules(auth.scoped, input) };
  if (tool === "GET_DOCUMENT_HEADING") {
    const { data, error } = await auth.scoped.rpc("resolve_document_letterhead", {
      p_document_type_code: String(input.documentTypeCode).toUpperCase(), p_brand: input.brand || null,
      p_business_area: input.businessArea || null, p_language: input.language || "it", p_at: input.at || new Date().toISOString().slice(0, 10),
    });
    if (error) throw error;
    return { resolution: data?.[0] || null };
  }
  if (tool === "LIST_UNASSIGNED_DOCUMENT_TYPES") {
    const [types, rules] = await Promise.all([listDocumentTypes(auth.scoped), listRules(auth.scoped)]);
    const assigned = new Set(rules.filter((item) => item.active).map((item) => item.document_type_code).filter(Boolean));
    return { documentTypes: types.filter((item) => !assigned.has(item.code)) };
  }
  if (tool === "LIST_SIGNATURES") return { signatures: await listSignatures(auth.scoped) };
  if (tool === "GET_SIGNATURE") return { signature: (await listSignatures(auth.scoped)).find((item) => item.id === input.signatureId) || null };
  throw Object.assign(new Error("Lo strumento richiesto non è di sola lettura."), { status: 400 });
}

export async function proposeHeadingWriteTool(auth, tool, input = {}, { correlationId = randomUUID() } = {}) {
  const descriptor = assertToolInput(tool, input);
  if (descriptor.risk !== "write") throw Object.assign(new Error("Lo strumento non richiede una proposta di scrittura."), { status: 400 });
  const requestId = randomUUID();
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  const idempotencyKey = createHash("sha256").update(`${auth.profile.id}:${correlationId}:${tool}:${canonical}`).digest("hex");
  const { data, error } = await auth.scoped.rpc("propose_heading_rule_action", {
    p_tool: tool, p_payload: input, p_request_id: requestId, p_correlation_id: correlationId, p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  const proposal = Array.isArray(data) ? data[0] : data;
  const [headings, documentTypes, signatures] = await Promise.all([listHeadings(auth.scoped), listDocumentTypes(auth.scoped), listSignatures(auth.scoped)]);
  const preview = {
    ...input,
    documentType: documentTypes.find((item) => item.code === String(input.documentTypeCode || "").toUpperCase()) || (input.ruleId ? { name: `Regola ${input.ruleId}` } : null),
    heading: headings.find((item) => item.id === input.letterheadId) || (input.headingId ? headings.find((item) => item.id === input.headingId) : null),
    signature: signatures.find((item) => item.id === input.signatureId) || null,
    scope: input.scope || input.placement || "Regola esistente",
  };
  return { requiresConfirmation: true, changed: false, headingAction: { id: proposal.id, tool, risk: "write", state: proposal.status, preview } };
}

export async function executeHeadingModelTool(auth, tool, input = {}, options = {}) {
  const descriptor = assertToolInput(tool, input);
  if (tool === "PROPOSE_HEADING_RULE") {
    const [headings, documentTypes, rules] = await Promise.all([listHeadings(auth.scoped), listDocumentTypes(auth.scoped), listRules(auth.scoped, { documentTypeCode: input.documentTypeCode })]);
    return { documentType: documentTypes.find((item) => item.code === String(input.documentTypeCode).toUpperCase()) || null, heading: headings.find((item) => item.id === input.letterheadId) || null, currentRules: rules, proposed: input, changed: false };
  }
  return descriptor.risk === "read_only" ? executeReadHeadingTool(auth, tool, input) : proposeHeadingWriteTool(auth, tool, input, options);
}

function matchEntity(prompt, rows, fields) {
  const text = normalized(prompt);
  return rows
    .map((row) => ({ row, score: Math.max(...fields.map((field) => normalized(row[field]).length && text.includes(normalized(row[field])) ? normalized(row[field]).length : 0)) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.row || null;
}

function commandKind(prompt) {
  const text = normalized(prompt);
  if (/non (hanno|ha).*(intestaz|carta intestata)|senza.*(intestaz|carta intestata)/.test(text)) return "unassigned";
  if (/quali.*(document|tip).*(usano|usa)|usata da/.test(text)) return "uses";
  if (/usa |associa |imposta |sostituisci /.test(text)) return "propose";
  return "list";
}

export async function interpretHeadingCommand(auth, body) {
  const prompt = String(body.prompt || "").trim().slice(0, 4000);
  if (!prompt) throw Object.assign(new Error("Richiesta intestazioni mancante."), { status: 400 });
  const kind = commandKind(prompt);
  const [headings, documentTypes, signatures] = await Promise.all([listHeadings(auth.scoped), listDocumentTypes(auth.scoped), listSignatures(auth.scoped)]);
  if (/\bfirma|firmatari/i.test(prompt)) {
    const signature = matchEntity(prompt, signatures, ["name", "code", "signer_name"]);
    const headingForSignature = matchEntity(prompt, headings, ["name", "code"]);
    if (/associa|inserisci|aggiungi|usa/i.test(prompt) && signature && headingForSignature) {
      const input = { headingId: headingForSignature.id, signatureId: signature.id, placement: "signature_block", label: signature.signer_role || null, sortOrder: 0 };
      const requestId = randomUUID(); const correlationId = body.correlationId || randomUUID();
      const idempotencyKey = createHash("sha256").update(`${auth.profile.id}:signature:${headingForSignature.id}:${signature.id}:signature_block`).digest("hex");
      const { data, error } = await auth.scoped.rpc("propose_heading_rule_action", { p_tool: "ATTACH_SIGNATURE_TO_HEADING", p_payload: input, p_request_id: requestId, p_correlation_id: correlationId, p_idempotency_key: idempotencyKey });
      if (error) throw error;
      const proposal = Array.isArray(data) ? data[0] : data;
      return { answer: `Ho preparato l’inserimento della firma ${signature.name} nell’intestazione ${headingForSignature.name}, nel blocco firma. Conferma esplicitamente per applicarlo.`, headingAction: { id: proposal.id, tool: "ATTACH_SIGNATURE_TO_HEADING", risk: "write", state: proposal.status, preview: { documentType: { name: "Blocco firma" }, heading: headingForSignature, scope: signature.name } } };
    }
    return { answer: signatures.length ? `Firme disponibili: ${signatures.map((item) => `${item.name} (${item.signer_name}, ${item.status})`).join(", ")}.` : "Non risultano firme configurate nella libreria.", headingTool: { tool: "LIST_SIGNATURES", risk: "read_only", result: signatures } };
  }
  if (kind === "unassigned") {
    const result = await executeReadHeadingTool(auth, "LIST_UNASSIGNED_DOCUMENT_TYPES");
    const mesOnly = /\bmes\b/i.test(prompt) ? result.documentTypes.filter((item) => ["mes", "both"].includes(item.system)) : result.documentTypes;
    return { answer: mesOnly.length ? `Tipi documento senza intestazione: ${mesOnly.map((item) => item.name).join(", ")}.` : "Tutti i tipi documento richiesti hanno un’intestazione configurata.", headingTool: { tool: "LIST_UNASSIGNED_DOCUMENT_TYPES", risk: "read_only", result: mesOnly } };
  }
  const heading = matchEntity(prompt, headings, ["name", "code"]);
  if (kind === "uses") {
    if (!heading) return { answer: "Indica il nome o il codice dell’intestazione da verificare.", headingTool: { tool: "LIST_HEADING_RULES", risk: "read_only", result: [] } };
    const rules = await listRules(auth.scoped, { letterheadId: heading.id });
    const typeByCode = new Map(documentTypes.map((item) => [item.code, item.name]));
    return { answer: rules.length ? `${heading.name} è usata da: ${rules.map((item) => typeByCode.get(item.document_type_code) || item.document_type_code || "default aziendale").join(", ")}.` : `${heading.name} non è associata ad alcun tipo documento.`, headingTool: { tool: "LIST_HEADING_RULES", risk: "read_only", result: rules } };
  }
  if (kind === "list") return { answer: headings.length ? `Intestazioni disponibili: ${headings.map((item) => `${item.name} (${item.status}, v${Math.max(0, ...item.company_letterhead_versions.map((v) => v.version))})`).join(", ")}.` : "Non risultano intestazioni aziendali configurate.", headingTool: { tool: "LIST_HEADINGS", risk: "read_only", result: headings } };
  if (!heading) return { answer: "Non trovo l’intestazione indicata nell’archivio ufficiale. Verifica nome o codice; nessuna modifica è stata proposta." };
  const documentType = matchEntity(prompt, documentTypes, ["name", "code", "description"]);
  if (!documentType) return { answer: "Non trovo un tipo documento reale corrispondente nel registry. Nessuna stringa o tipologia è stata creata automaticamente." };
  const input = { documentTypeCode: documentType.code, letterheadId: heading.id, scope: "global", brand: null, businessArea: null, language: null, priority: 0, validFrom: null, validTo: null };
  const requestId = randomUUID();
  const correlationId = body.correlationId || randomUUID();
  const idempotencyKey = createHash("sha256").update(`${auth.profile.id}:${documentType.code}:${heading.id}:global`).digest("hex");
  const { data, error } = await auth.scoped.rpc("propose_heading_rule_action", { p_tool: "CREATE_HEADING_RULE", p_payload: input, p_request_id: requestId, p_correlation_id: correlationId, p_idempotency_key: idempotencyKey });
  if (error) throw error;
  const proposal = Array.isArray(data) ? data[0] : data;
  return {
    answer: `Ho preparato la modifica. Tipo documento: ${documentType.name}. Nuova intestazione: ${heading.name}. Ambito: Globale. Conferma esplicitamente per applicarla.`,
    headingAction: { id: proposal.id, tool: "CREATE_HEADING_RULE", risk: "write", state: proposal.status, preview: { documentType, heading, scope: "Globale" } },
  };
}

export async function decideHeadingAction(auth, body) {
  const proposalId = String(body.proposalId || "").trim();
  if (!proposalId) throw Object.assign(new Error("Proposta intestazione mancante."), { status: 400 });
  const { data: pending, error: pendingError } = await auth.scoped.from("ai_action_audit").select("*").eq("id", proposalId).eq("user_id", auth.profile.id).maybeSingle();
  if (pendingError || !pending) throw Object.assign(new Error("Proposta non trovata o non autorizzata."), { status: 404 });
  if (pending.tool === "MES_DOCUMENT_GENERATE") return decideMesDocumentAction(auth, pending, body.decision === "confirm");
  const { data, error } = await auth.scoped.rpc("execute_heading_rule_action", { p_proposal_id: proposalId, p_confirm: body.decision === "confirm" });
  if (error) throw error;
  const action = Array.isArray(data) ? data[0] : data;
  const answer = action.status === "executed" ? "Operazione applicata e registrata nell’audit."
    : action.status === "failed" ? `Operazione non applicata. Audit dell’errore registrato: ${action.error || "errore controllato"}.`
      : "Proposta rifiutata. Nessuna modifica è stata applicata.";
  return { headingAction: { id: action.id, tool: action.tool, state: action.status, result: action.result }, answer };
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw Object.assign(new Error(`Configurazione server mancante: ${name}`), { status: 500 });
  return value;
}

async function decideMesDocumentAction(auth, pending, confirmed) {
  const { data: decided, error: decideError } = await auth.scoped.rpc("decide_external_ai_action", { p_proposal_id: pending.id, p_confirm: confirmed });
  if (decideError) throw decideError;
  const decision = Array.isArray(decided) ? decided[0] : decided;
  if (!confirmed) return { headingAction: { id: decision.id, tool: decision.tool, state: decision.status }, answer: "Proposta rifiutata. Nessuna modifica MES è stata applicata." };
  const path = String(process.env.PROGREMES_DOCUMENT_GENERATE_PATH || "/api/workspace/ai/documents/generate");
  const payload = Buffer.from(JSON.stringify({ documentTypeCode: pending.payload_summary.documentTypeCode, targetId: pending.payload_summary.targetId,
    idempotencyKey: pending.idempotency_key, requestId: pending.request_id, correlationId: pending.correlation_id,
    actor: `workspace:${auth.profile.id}`, confirmed: true }));
  const timestamp = Math.floor(Date.now() / 1000);
  const eventId = pending.request_id;
  let result = null; let failure = null;
  try {
    const response = await fetch(new URL(path, requiredEnvironment("PROGREMES_URL")), { method: "POST", signal: AbortSignal.timeout(Number(process.env.PROGREMES_API_TIMEOUT_MS || 15000)),
      headers: { "Content-Type": "application/json", [HMAC_HEADERS.timestamp]: String(timestamp), [HMAC_HEADERS.eventId]: eventId,
        [HMAC_HEADERS.signature]: signProductionMessage({ method: "POST", path, timestamp, eventId, body: payload, secret: requiredEnvironment("PROGREMES_INTEGRATION_SECRET") }) }, body: payload });
    result = await response.json().catch(() => ({}));
    if (!response.ok || result?.applied !== true) failure = result?.error || `ProgreMES ha risposto con stato ${response.status}.`;
  } catch (error) { failure = error?.message || "ProgreMES non raggiungibile."; }
  const { data: completed, error: completeError } = await auth.admin.rpc("complete_external_ai_action", { p_proposal_id: pending.id, p_succeeded: !failure, p_result: result || {}, p_error: failure });
  if (completeError) throw completeError;
  const action = Array.isArray(completed) ? completed[0] : completed;
  return { headingAction: { id: action.id, tool: action.tool, state: action.status, result: action.result },
    answer: failure ? `Operazione MES non applicata. Audit registrato: ${failure}` : "Documento MES generato tramite il servizio controllato e registrato nell’audit." };
}
