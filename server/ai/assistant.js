/* global Buffer, process */
import { createClient } from "@supabase/supabase-js";
import { generateText, isStepCount, jsonSchema, Output } from "ai";
import { openai } from "@ai-sdk/openai";

const DEFAULT_MODEL = "openai/gpt-5.6-luna";
const MAX_HISTORY_MESSAGES = 14;
const CHAT_RETENTION_DAYS = 60;
const MAX_ASSISTANT_ATTACHMENTS = 4;
const MAX_ASSISTANT_ATTACHMENT_BYTES = 2_800_000;
const ALLOWED_ASSISTANT_ATTACHMENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function progremesDataAvailable() {
  return String(process.env.PROGREMES_AI_PLANNING_ENABLED || "").toLowerCase() === "true";
}

function isTimeLearningRequest(value) {
  return /autoapprend|apprendiment|tempi?\s+(?:standard\w*|effettiv\w*|consuntiv\w*|produzion\w*|lavorazion\w*)|riduc(?:i|e|iamo|zione)\s+(?:i\s+)?tempi|aggiorn(?:a|are|amento)\s+(?:dei\s+)?tempi/i.test(String(value || ""));
}

const PROPOSAL_SCHEMA = jsonSchema({
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "criteria", "assumptions", "constraints", "changes", "warnings", "expectedBenefits", "executable"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    criteria: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    constraints: { type: "array", items: { type: "string" } },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["entity", "current", "proposed", "reason", "risk"],
        properties: {
          entity: { type: "string" },
          current: { type: "string" },
          proposed: { type: "string" },
          reason: { type: "string" },
          risk: { type: "string", enum: ["basso", "medio", "alto"] },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
    expectedBenefits: { type: "array", items: { type: "string" } },
    executable: { type: "boolean" },
  },
});

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw Object.assign(new Error(`Variabile Vercel mancante: ${name}`), { status: 500 });
  return value;
}

function adminClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function userClient(token) {
  const key = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return createClient(required("SUPABASE_URL"), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  if (!value.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  return value.slice(7).trim();
}

function cleanMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => ["user", "assistant"].includes(message?.role) && String(message?.content || "").trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({ role: message.role, content: String(message.content).trim().slice(0, 12000) }));
}

export function parseAssistantAttachments(body, capabilities = {}) {
  const submitted = Array.isArray(body?.attachments) ? body.attachments : [];
  if (!submitted.length) return [];
  if (capabilities.vision !== true) throw Object.assign(new Error("Analisi di immagini e documenti non abilitata per il tuo reparto."), { status: 403 });
  if (submitted.length > MAX_ASSISTANT_ATTACHMENTS) throw Object.assign(new Error(`Puoi allegare al massimo ${MAX_ASSISTANT_ATTACHMENTS} file per richiesta.`), { status: 400 });
  let totalBytes = 0;
  return submitted.map((attachment, index) => {
    const mediaType = String(attachment?.mediaType || "").toLowerCase();
    if (!ALLOWED_ASSISTANT_ATTACHMENT_TYPES.has(mediaType)) throw Object.assign(new Error("Formato allegato non supportato. Usa PDF, JPG, PNG o WebP."), { status: 400 });
    const fileBase64 = String(attachment?.fileBase64 || "").replace(/^data:[^;]+;base64,/, "").trim();
    if (!fileBase64) throw Object.assign(new Error("Uno degli allegati è vuoto o non leggibile."), { status: 400 });
    const data = Buffer.from(fileBase64, "base64");
    if (!data.byteLength) throw Object.assign(new Error("Uno degli allegati è vuoto o non leggibile."), { status: 400 });
    totalBytes += data.byteLength;
    if (totalBytes > MAX_ASSISTANT_ATTACHMENT_BYTES) throw Object.assign(new Error("Gli allegati superano 2,8 MB complessivi."), { status: 413 });
    return {
      type: "file",
      mediaType,
      data,
      filename: String(attachment?.fileName || `allegato-${index + 1}`).slice(0, 180),
    };
  });
}

function attachmentMetadata(attachments) {
  return attachments.map((attachment) => ({
    fileName: attachment.filename,
    mediaType: attachment.mediaType,
    sizeBytes: attachment.data.byteLength,
  }));
}

function userModelMessage(prompt, attachments) {
  if (!attachments.length) return { role: "user", content: prompt };
  return { role: "user", content: [{ type: "text", text: prompt }, ...attachments] };
}

function displayedPrompt(prompt, attachments) {
  if (!attachments.length) return prompt;
  return `${prompt}\n\nAllegati: ${attachments.map((attachment) => attachment.filename).join(", ")}`;
}

function wantsDownloadablePdf(...values) {
  const text = values.map((value) => String(value || "")).join("\n");
  const action = /elabor|report|scaric|alleg|document|file|esport|crea|genera|prepara|produci|stampa|fammi|vorrei|voglio/i.test(text);
  return action && /\bpdf\b/i.test(text);
}

export function requestedArtifacts(prompt, generationId) {
  const text = String(prompt || "");
  const action = /elabor|scaric|esport|crea|genera|prepara|produci|fammi|vorrei|voglio|mostra|visualizza/i.test(text);
  const chartRequested = action && /grafico|diagramma|chart/i.test(text);
  const imageRequested = action && /\b(?:immagine|png|jpe?g)\b/i.test(text);
  const genericFileRequested = action && /\b(?:file|documento|report)\b/i.test(text) && !chartRequested && !imageRequested;
  const artifacts = [];
  if (wantsDownloadablePdf(text) || genericFileRequested) artifacts.push({ id: `${generationId}-pdf`, kind: "pdf", fileName: "report-assistente-ai.pdf", mediaType: "application/pdf", includeChart: /grafico|diagramma|chart/i.test(text) });
  if (chartRequested || imageRequested) {
    const jpeg = /\b(?:jpe?g)\b/i.test(text);
    artifacts.push({
      id: `${generationId}-image`,
      kind: "image",
      fileName: jpeg ? "grafico-analisi.jpg" : "grafico-analisi.png",
      mediaType: jpeg ? "image/jpeg" : "image/png",
    });
  }
  return artifacts;
}

function pick(row, keys) {
  return Object.fromEntries(keys.filter((key) => row?.[key] !== undefined).map((key) => [key, row[key]]));
}

async function safeQuery(label, callback) {
  const startedAt = Date.now();
  try {
    const { data, error } = await callback();
    if (error) throw error;
    const durationMs = Date.now() - startedAt;
    if (durationMs >= 2000) {
      console.warn(JSON.stringify({ level: "warning", message: "AI context query slow", label, durationMs }));
    }
    return { label, rows: data || [] };
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      message: "AI context query failed",
      label,
      error: String(error?.message || "Dati non disponibili").slice(0, 500),
      durationMs: Date.now() - startedAt,
    }));
    return { label, rows: [], unavailable: error?.message || "Dati non disponibili" };
  }
}

export async function authorizeAIRequest(req, { bypassAIEntitlements = false } = {}) {
  const token = bearerToken(req);
  const admin = adminClient();
  const scoped = userClient(token);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData?.user?.id) throw Object.assign(new Error("Sessione non valida."), { status: 401 });

  const { data: profile, error: profileError } = await admin
    .from("utenti")
    .select("id,nome,cognome,email,attivo,ruolo_id,ruoli(nome,amministratore_workspace,ambito_dati,livello_accesso,livello_ai)")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.attivo === false) {
    throw Object.assign(new Error("Profilo Workspace non valido o disabilitato."), { status: 403 });
  }

  const [accessResult, capabilitiesResult] = await Promise.all([
    scoped.rpc("workspace_access_context"),
    bypassAIEntitlements ? Promise.resolve({ data: {}, error: null }) : scoped.rpc("workspace_ai_capabilities"),
  ]);
  if (accessResult.error) throw accessResult.error;
  const workspaceAdmin = profile.ruoli?.amministratore_workspace === true;
  if (capabilitiesResult.error && !workspaceAdmin) throw capabilitiesResult.error;
  const access = accessResult.data || {};
  const reportedCapabilities = capabilitiesResult.data || {};
  const baseCapabilities = workspaceAdmin || bypassAIEntitlements ? {
    ...reportedCapabilities,
    module_access: true,
    internal_data: true,
    web_search: true,
    orders: true,
    progremes: true,
    planning: true,
    apply_plans: true,
    vision: true,
    monthly_limit: null,
    monthly_cost_limit_usd: null,
    cost_limit_exceeded: false,
    daily_document_limit: null,
    max_document_pages: null,
    max_operation_cost_usd: null,
  } : reportedCapabilities;
  const capabilities = {
    ...baseCapabilities,
    progremes_data: baseCapabilities.progremes === true && progremesDataAvailable(),
  };
  if (!bypassAIEntitlements && capabilities.module_access !== true) {
    throw Object.assign(new Error("Accesso al modulo Assistente AI non autorizzato."), { status: 403 });
  }
  return { token, admin, scoped, profile, access, capabilities };
}

function assertModeAllowed(mode, capabilities) {
  if (mode === "web" && !capabilities.web_search) throw Object.assign(new Error("Ricerca Web non abilitata per il tuo reparto."), { status: 403 });
  if (mode === "ordini" && !capabilities.orders) throw Object.assign(new Error("Consultazione ordini non abilitata per il tuo reparto."), { status: 403 });
  if (mode === "pianificazione" && !capabilities.planning) throw Object.assign(new Error("Pianificazione AI non abilitata per il tuo reparto."), { status: 403 });
  const limit = Number(capabilities.monthly_limit || 0);
  if (limit > 0 && Number(capabilities.monthly_requests || 0) >= limit) {
    throw Object.assign(new Error("Limite mensile di richieste AI raggiunto."), { status: 429 });
  }
  if (capabilities.cost_limit_exceeded === true) {
    throw Object.assign(new Error("Limite mensile di spesa AI raggiunto."), { status: 429 });
  }
}

async function buildActivitiesContext(scoped, access, isAdmin) {
  const [projectsResult, phasesResult, projectDepartmentsResult, phaseDepartmentsResult] = await Promise.all([
    safeQuery("progetti", () => scoped.from("v4_progetti").select("*").order("created_at", { ascending: false }).limit(100)),
    safeQuery("fasi", () => scoped.from("v4_fasi_progetto").select("*").order("deadline", { ascending: true, nullsFirst: false }).limit(180)),
    safeQuery("reparti_progetti", () => scoped.from("v4_progetto_reparti").select("progetto_id,reparto_id").limit(1000)),
    safeQuery("reparti_fasi", () => scoped.from("v4_fase_reparti").select("fase_id,reparto_id,completato").limit(1500)),
  ]);
  const departmentIds = new Set(access.department_ids || []);
  const permissions = new Set(access.permissions || []);
  const canReadAll = isAdmin || permissions.has("projects.read.all") || permissions.has("tasks.read.all");
  const projectLinks = projectDepartmentsResult.rows;
  const visibleProjects = projectsResult.rows.filter((project) => {
    if (canReadAll) return true;
    const linked = projectLinks.filter((row) => row.progetto_id === project.id).map((row) => row.reparto_id).filter(Boolean);
    return !linked.length || linked.some((id) => departmentIds.has(id));
  });
  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));
  const phaseLinks = phaseDepartmentsResult.rows;
  const visiblePhases = phasesResult.rows.filter((phase) => {
    if (phase.progetto_id && !visibleProjectIds.has(phase.progetto_id)) return false;
    if (canReadAll || permissions.has("tasks.read.project_departments")) return true;
    const linked = phaseLinks.filter((row) => row.fase_id === phase.id).map((row) => row.reparto_id).filter(Boolean);
    if (linked.length) return linked.some((id) => departmentIds.has(id));
    return !phase.reparto_id || departmentIds.has(phase.reparto_id);
  });
  return {
    projects: visibleProjects.slice(0, 80).map((row) => pick(row, ["id", "titolo", "descrizione", "deadline", "priorita", "stato", "created_at"])),
    phases: visiblePhases.slice(0, 140).map((row) => pick(row, ["id", "progetto_id", "titolo", "descrizione", "deadline", "priorita", "stato", "ordine", "reparto_id", "completata", "completato"])),
  };
}

async function buildOrdersContext(scoped, access, isAdmin) {
  const modules = new Set(access.modules || []);
  const allowedModules = isAdmin ? ["prof", "ph"] : [modules.has("ordini_pr") && "prof", modules.has("ordini_ph") && "ph"].filter(Boolean);
  if (!allowedModules.length) return { note: "Nessun modulo ordini autorizzato." };
  const [{ data: integrations }, { data: agentCodes }] = await Promise.all([
    scoped.from("integrazioni_utenti").select("modulo,enabled,ruolo_ordini"),
    scoped.rpc("visible_mexal_agent_codes"),
  ]);
  const integrationByModule = new Map((integrations || []).map((row) => [row.modulo, row]));
  const codes = (Array.isArray(agentCodes) ? agentCodes : []).map((value) => String(value || "").trim()).filter(Boolean);
  const results = [];
  for (const moduleCode of allowedModules) {
    const integrationCode = moduleCode === "ph" ? "gestione_ordini_ph" : "gestione_ordini_pr";
    const integration = integrationByModule.get(integrationCode);
    if (!isAdmin && integration?.enabled !== true) continue;
    let query = scoped.from("ordini_testate").select("*").or(moduleCode === "prof" ? "modulo_ordini.eq.prof,modulo_ordini.is.null" : "modulo_ordini.eq.ph").order("data_ordine", { ascending: false }).limit(80);
    if (!isAdmin && integration?.ruolo_ordini !== "backoffice") {
      if (!codes.length) continue;
      query = query.in("codice_agente_mexal", codes);
    }
    const result = await safeQuery(`ordini_${moduleCode}`, () => query);
    results.push(...result.rows.map((row) => pick(row, ["id", "modulo_ordini", "numero_ordine_visualizzato", "numero_ordine", "data_ordine", "codice_cliente", "ragione_sociale_cliente", "codice_agente_mexal", "stato", "stato_sincronizzazione", "totale_imponibile", "totale_iva", "totale_documento", "totale", "errore_sincronizzazione"])))
  }
  return { orders: results.slice(0, 120) };
}

async function buildSalesInvoicesContext(scoped, requestText = "") {
  const wantsCustomerReorders = /client|riordin|riacquist|ripetut|frequenz|fidel/i.test(requestText);
  const [salesResult, reorderResult] = await Promise.all([
    safeQuery("fatture_vendita_analitiche", () => (
      scoped.rpc("workspace_ai_sales_invoice_context", { p_limit: 100 })
    )),
    wantsCustomerReorders
      ? safeQuery("riordini_clienti_da_fatture", () => (
        scoped.rpc("workspace_ai_customer_reorder_context", { p_customer_limit: 80, p_product_limit: 40 })
      ))
      : Promise.resolve(null),
  ]);
  if (salesResult.unavailable && (!reorderResult || reorderResult.unavailable)) {
    return { available: false, note: salesResult.unavailable };
  }
  return {
    available: true,
    ...(salesResult.unavailable ? { invoiceSummaryUnavailable: salesResult.unavailable } : salesResult.rows),
    ...(reorderResult ? {
      customerReorders: reorderResult.unavailable
        ? { available: false, note: reorderResult.unavailable }
        : { available: true, ...reorderResult.rows },
    } : {}),
  };
}

async function readProgremesPlanningContext() {
  if (!progremesDataAvailable()) {
    return { connector: "not_configured", note: "ProgreMES non espone ancora il contratto AI per il piano produttivo." };
  }
  const url = new URL(String(process.env.PROGREMES_AI_CONTEXT_PATH || "/api/workspace/ai/planning/context"), required("PROGREMES_URL"));
  const response = await fetch(url, { headers: { "X-Workspace-Secret": required("PROGREMES_INTEGRATION_SECRET") } });
  if (!response.ok) throw new Error(`Lettura piano ProgreMES non riuscita (${response.status}).`);
  return { connector: "available", data: await response.json() };
}

async function buildInternalContext({ scoped, profile, access, capabilities }, requestText = "", memory = []) {
  if (!capabilities.internal_data) return { note: "Accesso ai dati interni non abilitato." };
  const isAdmin = profile.ruoli?.amministratore_workspace === true;
  const businessModules = new Set(access.modules || []);
  const allowedAIModules = Array.isArray(capabilities.allowed_modules)
    ? new Set(capabilities.allowed_modules)
    : businessModules;
  const modules = new Set([...businessModules].filter((code) => isAdmin || allowedAIModules.has(code)));
  const context = {
    user: pick(profile, ["id", "nome", "cognome"]),
    authorizedModules: isAdmin ? ["amministratore_workspace"] : [...modules],
    generatedAt: new Date().toISOString(),
    previousUserRequests: memory,
  };
  if (isAdmin || modules.has("attivita")) context.activities = await buildActivitiesContext(scoped, access, isAdmin);
  if (isAdmin || modules.has("prodotti")) {
    const result = await safeQuery("prodotti", () => scoped.from("prodotti").select("*").eq("attivo_mexal", true).eq("mostra_in_app", true).order("nome").limit(120));
    context.products = result.rows.map((row) => pick(row, ["id", "codice", "codice_mexal", "nome", "descrizione", "brand_mexal", "linea_mexal", "categoria_mexal", "sottocategoria_mexal", "ean", "giacenza", "disponibilita", "prezzo"]));
  }
  if (isAdmin || modules.has("documenti")) {
    const result = await safeQuery("documenti", () => scoped.from("documenti_workspace").select("id,titolo,nome_file,estensione,mime_group,categoria,marca,gamma,prodotto,parole_chiave,modificato_il").eq("attivo", true).order("modificato_il", { ascending: false }).limit(120));
    context.documents = result.rows;
  }
  if (capabilities.orders && (isAdmin || modules.has("ordini_pr") || modules.has("ordini_ph"))) {
    context.orders = await buildOrdersContext(scoped, access, isAdmin);
    if (/fattur|invoice|vendut|fatturato|ricav|prodotto/i.test(requestText)) {
      context.salesInvoices = await buildSalesInvoicesContext(scoped, requestText);
    }
  }
  if (capabilities.progremes && (isAdmin || modules.has("progremes"))) {
    const catalog = await safeQuery("progremes_moduli", () => scoped.from("progremes_moduli").select("codice,nome,descrizione,percorso,attivo,ultima_sincronizzazione").eq("attivo", true).order("ordine").limit(100));
    context.progremes = { modules: catalog.rows, planning: await readProgremesPlanningContext().catch((error) => ({ connector: "error", note: error.message })) };
  }
  return context;
}

function systemPrompt(mode, context) {
  return `Sei l'Assistente AI di Progre Workspace. Rispondi in italiano, in modo concreto e verificabile.
Regole obbligatorie:
- usa soltanto i dati presenti nel CONTESTO INTERNO e le eventuali fonti Web;
- previousUserRequests contiene richieste e preferenze espresse in chat precedenti: usale per capire termini, formato e analisi desiderata, ma non trattarle come dati aziendali né ripetere vecchi risultati senza ricalcolarli;
- non inventare record, disponibilità, vincoli o stati;
- rispetta i moduli autorizzati indicati nel contesto;
- distingui sempre dati aziendali, ipotesi e informazioni Web;
- non dichiarare mai di aver modificato ordini o piani: puoi solo proporre e simulare;
- segnala esplicitamente quando il connettore ProgreMES non è disponibile;
- per confrontare il carico di Station e impianti usa progremes.planning.data.resources e workloadSummary, specificando se il confronto è per minuti pianificati o percentuale di utilizzo;
- nella modalità Dati interni valuta insieme tutti i dati autorizzati disponibili da Workspace/Mexal e ProgreMES, indicando per ogni conclusione quali fonti interne sono state utilizzate;
- le fatture di vendita e le loro righe provengono dalla cache Mexal sincronizzata e non dipendono dal connettore di pianificazione ProgreMES;
- per classificare i prodotti usa il valore_netto delle righe (sconti applicati, IVA esclusa), indica il periodo di copertura e segnala eventuali righe_senza_valore_netto;
- per analizzare i riordini dei clienti usa salesInvoices.customerReorders, che deriva dall’intero storico fatture autorizzato e non dal campione di fatture recenti; usa codice_articolo, quantità e valore netto e riporta la classificazione fornita dal contesto;
- quando il messaggio contiene allegati, analizza insieme testo, immagini e PDF; indica chiaramente i dati incerti, illeggibili o non riconosciuti e non inventare i contenuti mancanti;
- quando l'utente richiede un grafico, includi nei risultati una tabella Markdown con la prima colonna descrittiva e le colonne successive numeriche; usa valori non abbreviati, così l'interfaccia può generare il vero file grafico;
- se l’utente chiede un report PDF o un documento scaricabile, prepara direttamente il contenuto completo e ben strutturato: l’interfaccia lo trasformerà in un vero file allegato, quindi non descrivere la procedura e non dire che non puoi crearlo;
- non esporre dettagli tecnici, credenziali o dati non necessari.
Modalità richiesta: ${mode}.
CONTESTO INTERNO:
${JSON.stringify(context)}`;
}

function sourceList(result) {
  return (result.sources || []).filter((source) => source.sourceType === "url" && source.url).map((source) => ({
    id: source.id,
    title: source.title || source.url,
    url: source.url,
  }));
}

function usageNumbers(usage) {
  return {
    input: Number(usage?.inputTokens || 0),
    output: Number(usage?.outputTokens || 0),
  };
}

function gatewayCost(result) {
  const stepCosts = (Array.isArray(result?.steps) ? result.steps : [])
    .map((step) => Number(step?.providerMetadata?.gateway?.cost))
    .filter(Number.isFinite);
  if (stepCosts.length) return stepCosts.reduce((total, cost) => total + cost, 0);
  const cost = Number(result?.providerMetadata?.gateway?.cost);
  return Number.isFinite(cost) ? cost : 0;
}

function gatewayOptions(profileId, feature) {
  return {
    gateway: {
      user: profileId,
      tags: ["app:sali-task", `feature:${feature}`],
    },
  };
}

export async function startAIGeneration(admin, { profileId, conversationId, type, model }) {
  const { data, error } = await admin.from("ai_generazioni").insert({
    utente_id: profileId,
    conversazione_id: conversationId,
    tipo: type,
    modello: model,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function failAIGeneration(admin, generationId, error) {
  await admin.from("ai_generazioni").update({
    stato: "errore",
    errore: String(error?.message || "Generazione non riuscita").slice(0, 1000),
    completata_il: new Date().toISOString(),
  }).eq("id", generationId);
}

export async function completeAIGeneration(admin, { generationId, profileId, result }) {
  const usage = result.totalUsage || result.usage;
  const tokens = usageNumbers(usage);
  const cost = gatewayCost(result);
  const { error } = await admin.from("ai_generazioni").update({
    stato: "completata",
    token_input: tokens.input,
    token_output: tokens.output,
    costo_usd: cost,
    provider_request_id: result?.response?.id || null,
    metadati: { finishReason: result?.finishReason || null, costSource: cost > 0 ? "gateway" : "not_reported" },
    completata_il: new Date().toISOString(),
  }).eq("id", generationId);
  if (error) throw error;
  const usageResult = await admin.rpc("workspace_record_ai_usage", {
    p_utente_id: profileId,
    p_token_input: tokens.input,
    p_token_output: tokens.output,
    p_costo_usd: cost,
  });
  if (usageResult.error) throw usageResult.error;
  return { ...tokens, cost };
}

// Compatibilità con i controlli e le integrazioni introdotti con la prima
// rendicontazione AI.
export const startGeneration = startAIGeneration;
export const failGeneration = failAIGeneration;
export const completeGeneration = completeAIGeneration;

async function ownedTopicId(admin, profileId, requestedId) {
  const topicId = String(requestedId || "").trim();
  if (!topicId) return null;
  const { data } = await admin.from("ai_argomenti").select("id").eq("id", topicId).eq("utente_id", profileId).maybeSingle();
  if (!data?.id) throw Object.assign(new Error("Argomento o progetto non trovato."), { status: 404 });
  return data.id;
}

async function ensureConversation(admin, profileId, requestedId, mode, prompt, requestedTopicId = "") {
  if (requestedId) {
    const { data } = await admin.from("ai_conversazioni").select("id").eq("id", requestedId).eq("utente_id", profileId).maybeSingle();
    if (data?.id) return data.id;
  }
  const topicId = await ownedTopicId(admin, profileId, requestedTopicId);
  const { data, error } = await admin.from("ai_conversazioni").insert({
    utente_id: profileId,
    titolo: prompt.slice(0, 90) || "Nuova conversazione",
    modalita: mode,
    argomento_id: topicId,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function conversationMessages(admin, profileId, conversationId) {
  if (!conversationId) return [];
  const { data: conversation } = await admin
    .from("ai_conversazioni")
    .select("id")
    .eq("id", conversationId)
    .eq("utente_id", profileId)
    .maybeSingle();
  if (!conversation) return [];
  const { data, error } = await admin
    .from("ai_messaggi")
    .select("id,ruolo,contenuto,fonti,metadati,creato_il")
    .eq("conversazione_id", conversationId)
    .order("creato_il", { ascending: true })
    .limit(100);
  if (error) throw error;
  return data || [];
}

async function recentUserMemory(admin, profileId, excludeConversationId = "", topicId = null) {
  let query = admin
    .from("ai_messaggi")
    .select("contenuto,creato_il,conversazione_id,ai_conversazioni!inner(utente_id,argomento_id)")
    .eq("ruolo", "user")
    .eq("ai_conversazioni.utente_id", profileId)
    .order("creato_il", { ascending: false })
    .limit(24);
  if (excludeConversationId) query = query.neq("conversazione_id", excludeConversationId);
  query = topicId ? query.eq("ai_conversazioni.argomento_id", topicId) : query.is("ai_conversazioni.argomento_id", null);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).reverse().map((row) => String(row.contenuto || "").trim().slice(0, 2000)).filter(Boolean);
}

async function listConversations(auth) {
  const staleBefore = new Date(Date.now() - CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [conversationResult, topicResult, staleResult] = await Promise.all([
    auth.admin.from("ai_conversazioni").select("id,titolo,modalita,argomento_id,creata_il,aggiornata_il").eq("utente_id", auth.profile.id).order("aggiornata_il", { ascending: false }).limit(100),
    auth.admin.from("ai_argomenti").select("id,nome,tipo,creato_il,aggiornato_il").eq("utente_id", auth.profile.id).order("aggiornato_il", { ascending: false }),
    auth.admin.from("ai_conversazioni").select("id", { count: "exact" }).eq("utente_id", auth.profile.id).lt("aggiornata_il", staleBefore),
  ]);
  if (conversationResult.error) throw conversationResult.error;
  if (topicResult.error) throw topicResult.error;
  if (staleResult.error) throw staleResult.error;
  return { conversations: conversationResult.data || [], topics: topicResult.data || [], retention: { days: CHAT_RETENTION_DAYS, staleCount: staleResult.count || 0, staleConversationIds: (staleResult.data || []).map((item) => item.id) }, capabilities: auth.capabilities };
}

async function createTopic(auth, body) {
  const name = String(body.name || "").trim().slice(0, 100);
  const type = body.type === "progetto" ? "progetto" : "argomento";
  if (!name) throw Object.assign(new Error("Inserisci il nome dell’argomento o progetto."), { status: 400 });
  const { data, error } = await auth.admin.from("ai_argomenti").insert({ utente_id: auth.profile.id, nome: name, tipo: type }).select("id,nome,tipo,creato_il,aggiornato_il").single();
  if (error?.code === "23505") throw Object.assign(new Error("Esiste già un gruppo con questo nome."), { status: 409 });
  if (error) throw error;
  return { topic: data };
}

async function deleteConversation(auth, body) {
  const conversationId = String(body.conversationId || "").trim();
  if (!conversationId) throw Object.assign(new Error("Conversazione non specificata."), { status: 400 });
  const { data, error } = await auth.admin.from("ai_conversazioni").delete().eq("id", conversationId).eq("utente_id", auth.profile.id).select("id").maybeSingle();
  if (error) throw error;
  if (!data?.id) throw Object.assign(new Error("Conversazione non trovata."), { status: 404 });
  return { deletedConversationId: data.id };
}

async function deleteStaleConversations(auth) {
  const staleBefore = new Date(Date.now() - CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await auth.admin.from("ai_conversazioni").delete().eq("utente_id", auth.profile.id).lt("aggiornata_il", staleBefore).select("id");
  if (error) throw error;
  return { deletedCount: data?.length || 0, retentionDays: CHAT_RETENTION_DAYS };
}

async function loadConversation(auth, body) {
  const conversationId = String(body.conversationId || "").trim();
  const messages = await conversationMessages(auth.admin, auth.profile.id, conversationId);
  const { data: conversation } = await auth.admin
    .from("ai_conversazioni")
    .select("id,titolo,modalita,argomento_id,creata_il,aggiornata_il")
    .eq("id", conversationId)
    .eq("utente_id", auth.profile.id)
    .maybeSingle();
  if (!conversation) throw Object.assign(new Error("Conversazione non trovata."), { status: 404 });
  return { conversation, messages, capabilities: auth.capabilities };
}

async function saveExchange(admin, conversationId, prompt, answer, sources, metadata = {}, userMetadata = {}) {
  const now = new Date().toISOString();
  const safeSources = Array.isArray(sources) ? sources : [];
  const safeMetadata = metadata && typeof metadata === "object" ? metadata : {};
  const safeUserMetadata = userMetadata && typeof userMetadata === "object" ? userMetadata : {};
  const { error } = await admin.from("ai_messaggi").insert([
    { conversazione_id: conversationId, ruolo: "user", contenuto: prompt, fonti: [], metadati: safeUserMetadata },
    { conversazione_id: conversationId, ruolo: "assistant", contenuto: answer, fonti: safeSources, metadati: safeMetadata },
  ]);
  if (error) throw error;
  await admin.from("ai_conversazioni").update({ aggiornata_il: now }).eq("id", conversationId);
}

function buildTimeLearningProposal(candidates) {
  const usable = (Array.isArray(candidates) ? candidates : []).filter((candidate) => candidate?.executable === true);
  const learningFingerprint = usable.map((candidate) => candidate.evidenceSignature).sort().join(":");
  return {
    title: usable.length ? "Revisione controllata dei tempi standard" : "Verifica dei tempi standard",
    summary: usable.length
      ? `ProgreMES ha rilevato ${usable.length} lavorazioni con tempi consuntivi stabilmente inferiori allo standard. La ripianificazione riguarderà soltanto gli ordini non ancora avviati.`
      : "Non risultano ancora lavorazioni con almeno tre consuntivi comparabili e sufficientemente stabili per proporre una riduzione.",
    criteria: [
      "Almeno 3 lavorazioni concluse della stessa versione di ciclo.",
      "Confronto su lotti compresi tra l’80% e il 120% del lotto standard.",
      "Mediana dei tempi netti, fermate escluse, con variabilità massima del 25%.",
      "Riduzione proposta solo se almeno il 15% inferiore allo standard corrente.",
    ],
    assumptions: [],
    constraints: ["Le produzioni iniziate o concluse non vengono modificate.", "Ogni variazione richiede approvazione di un utente autorizzato."],
    changes: usable.map((candidate) => ({
      entity: `${candidate.formulaCode} · versione ${candidate.formulaVersion}`,
      current: `${candidate.currentMinutes / 60} ore`,
      proposed: `${candidate.proposedMinutes / 60} ore`,
      reason: `${candidate.sampleCount} consuntivi comparabili; mediana ${candidate.medianMinutes} minuti; riduzione ${candidate.reductionPercent}%.`,
      risk: candidate.variationPercent <= 15 ? "basso" : "medio",
    })),
    warnings: usable.length ? [] : ["Continuare a raccogliere consuntivi prima di modificare il tempo standard."],
    expectedBenefits: usable.length ? ["Piano più aderente ai tempi reali.", "Capacità produttiva disponibile calcolata con maggiore precisione."] : [],
    executable: usable.length > 0,
    learningFingerprint,
    application: {
      kind: "production_time_revision",
      candidates: usable.map((candidate) => ({
        formulaVersionId: candidate.formulaVersionId,
        currentMinutes: candidate.currentMinutes,
        proposedMinutes: candidate.proposedMinutes,
        evidenceSignature: candidate.evidenceSignature,
      })),
    },
  };
}

async function listAutoplanning(auth) {
  const { data, error } = await auth.admin
    .from("ai_proposte")
    .select("id,tipo,titolo,stato,criterio,proposta,errore,creata_il,approvata_il,applicata_il")
    .eq("utente_id", auth.profile.id)
    .eq("tipo", "piano_produzione")
    .order("creata_il", { ascending: false })
    .limit(50);
  if (error) throw error;
  const proposals = (data || [])
    .filter((item) => item?.proposta?.learningFingerprint)
    .map((item) => ({
      id: item.id,
      type: item.tipo,
      state: item.stato,
      createdAt: item.creata_il,
      approvedAt: item.approvata_il,
      appliedAt: item.applicata_il,
      error: item.errore,
      ...item.proposta,
    }));
  return { proposals, pendingCount: proposals.filter((item) => item.state === "bozza").length, capabilities: auth.capabilities };
}

export async function runAutomaticTimeLearningScan() {
  if (!progremesDataAvailable()) return { created: 0, candidates: 0, connectorDisabled: true };
  const admin = adminClient();
  const context = await readProgremesPlanningContext();
  const proposal = buildTimeLearningProposal(context?.data?.timeLearning?.candidates || []);
  if (!proposal.executable || !proposal.learningFingerprint) return { created: 0, candidates: 0 };
  const { data: administrators, error: administratorsError } = await admin
    .from("utenti")
    .select("id,ruoli!inner(amministratore_workspace)")
    .eq("attivo", true)
    .eq("ruoli.amministratore_workspace", true);
  if (administratorsError) throw administratorsError;
  let created = 0;
  for (const administrator of administrators || []) {
    const { data: recent, error: recentError } = await admin
      .from("ai_proposte")
      .select("id,proposta")
      .eq("utente_id", administrator.id)
      .eq("tipo", "piano_produzione")
      .order("creata_il", { ascending: false })
      .limit(50);
    if (recentError) throw recentError;
    if ((recent || []).some((item) => item?.proposta?.learningFingerprint === proposal.learningFingerprint)) continue;
    const { data: stored, error: insertError } = await admin.from("ai_proposte").insert({
      utente_id: administrator.id,
      tipo: "piano_produzione",
      titolo: proposal.title,
      criterio: "Verifica automatica dei tempi standard sui consuntivi ProgreMES.",
      proposta: proposal,
    }).select("id").single();
    if (insertError) throw insertError;
    await admin.from("ai_audit_log").insert({
      utente_id: administrator.id,
      azione: "proposta_tempi_automatica_creata",
      entita_tipo: "piano_produzione",
      entita_id: stored.id,
      dettagli: { candidates: proposal.application.candidates.length, fingerprint: proposal.learningFingerprint },
    });
    created += 1;
  }
  return { created, candidates: proposal.application.candidates.length };
}

async function chat(auth, body) {
  const mode = ["interno", "web", "ordini"].includes(body.mode) ? body.mode : "interno";
  assertModeAllowed(mode, auth.capabilities);
  const attachments = parseAssistantAttachments(body, auth.capabilities);
  const submittedMessages = cleanMessages(body.messages);
  const prompt = String(body.prompt || submittedMessages.at(-1)?.content || (attachments.length ? "Analizza i documenti allegati e riassumi i dati rilevanti." : "")).trim().slice(0, 12000);
  if (!prompt) throw Object.assign(new Error("Scrivi una richiesta per l’assistente."), { status: 400 });
  const conversationId = await ensureConversation(auth.admin, auth.profile.id, body.conversationId, mode, prompt, body.topicId);
  const { data: conversationScope } = await auth.admin.from("ai_conversazioni").select("argomento_id").eq("id", conversationId).eq("utente_id", auth.profile.id).single();
  const [persistedRows, memory] = await Promise.all([
    conversationMessages(auth.admin, auth.profile.id, conversationId),
    recentUserMemory(auth.admin, auth.profile.id, conversationId, conversationScope?.argomento_id || null),
  ]);
  const persistedMessages = cleanMessages(persistedRows.map((row) => ({ role: row.ruolo, content: row.contenuto })));
  const messages = [...persistedMessages, userModelMessage(prompt, attachments)].slice(-MAX_HISTORY_MESSAGES);
  const requestText = [...memory, ...persistedMessages.map((message) => message.content), prompt].join("\n");
  const context = await buildInternalContext(auth, requestText, memory);
  const tools = mode === "web" ? { web_search: openai.tools.webSearch({ externalWebAccess: true, searchContextSize: "medium" }) } : undefined;
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const generationId = await startAIGeneration(auth.admin, {
    profileId: auth.profile.id,
    conversationId,
    type: mode === "web" ? "ricerca_web" : mode === "ordini" ? "analisi_ordini" : "chat_interna",
    model,
  });
  let result;
  try {
    result = await generateText({
      model,
      system: systemPrompt(mode, context),
      messages,
      tools,
      stopWhen: tools ? isStepCount(6) : undefined,
      maxOutputTokens: 1800,
      providerOptions: gatewayOptions(auth.profile.id, mode),
    });
  } catch (error) {
    await failAIGeneration(auth.admin, generationId, error);
    throw error;
  }
  const usage = await completeAIGeneration(auth.admin, { generationId, profileId: auth.profile.id, result });
  const sources = sourceList(result);
  const artifacts = requestedArtifacts(prompt, generationId);
  const downloadablePdf = artifacts.some((artifact) => artifact.kind === "pdf");
  const storedAttachments = attachmentMetadata(attachments);
  await saveExchange(auth.admin, conversationId, displayedPrompt(prompt, attachments), result.text, sources, { model, mode, generationId, costUsd: usage.cost, downloadablePdf, artifacts }, { attachments: storedAttachments });
  return { conversationId, answer: result.text, sources, usage, capabilities: auth.capabilities, downloadablePdf, artifacts };
}

async function createProposal(auth, body) {
  assertModeAllowed("pianificazione", auth.capabilities);
  const attachments = parseAssistantAttachments(body, auth.capabilities);
  const criterion = String(body.prompt || (attachments.length ? "Analizza i documenti allegati e prepara una proposta di pianificazione." : "")).trim().slice(0, 12000);
  if (!criterion) throw Object.assign(new Error("Indica il criterio di pianificazione."), { status: 400 });
  const proposalType = ["piano_produzione", "piano_ordini", "piano_attivita"].includes(body.proposalType) ? body.proposalType : "piano_produzione";
  if (proposalType === "piano_produzione" && !auth.capabilities.progremes) throw Object.assign(new Error("Pianificazione ProgreMES non abilitata."), { status: 403 });
  if (proposalType === "piano_ordini" && !auth.capabilities.orders) throw Object.assign(new Error("Pianificazione ordini non abilitata."), { status: 403 });
  const context = await buildInternalContext(auth, criterion);
  if (proposalType === "piano_produzione" && isTimeLearningRequest(criterion)) {
    const candidates = context?.progremes?.planning?.data?.timeLearning?.candidates || [];
    const usable = candidates.filter((candidate) => candidate?.executable === true);
    if (body.automatic === true && usable.length === 0) return { proposal: null, capabilities: auth.capabilities };
    const learningFingerprint = usable.map((candidate) => candidate.evidenceSignature).sort().join(":");
    if (body.automatic === true && learningFingerprint) {
      const { data: recentProposals, error: recentError } = await auth.admin
        .from("ai_proposte")
        .select("id,stato,proposta")
        .eq("utente_id", auth.profile.id)
        .eq("tipo", "piano_produzione")
        .order("creata_il", { ascending: false })
        .limit(20);
      if (recentError) throw recentError;
      const alreadyProposed = (recentProposals || []).some((item) =>
        item?.proposta?.learningFingerprint === learningFingerprint && item.stato !== "rifiutata");
      if (alreadyProposed) return { proposal: null, capabilities: auth.capabilities };
    }
    const proposal = buildTimeLearningProposal(usable);
    const conversationId = await ensureConversation(auth.admin, auth.profile.id, body.conversationId, "pianificazione", criterion, body.topicId);
    const { data: stored, error } = await auth.admin.from("ai_proposte").insert({
      conversazione_id: conversationId,
      utente_id: auth.profile.id,
      tipo: proposalType,
      titolo: proposal.title,
      criterio: criterion,
      proposta: proposal,
    }).select("id,stato,creata_il").single();
    if (error) throw error;
    const answer = `${proposal.title}\n\n${proposal.summary}`;
    await saveExchange(auth.admin, conversationId, criterion, answer, [], { proposalId: stored.id, proposalType, deterministic: true });
    await auth.admin.from("ai_audit_log").insert({ utente_id: auth.profile.id, azione: "proposta_tempi_creata", entita_tipo: proposalType, entita_id: stored.id, dettagli: { candidates: usable.length } });
    return { conversationId, answer, proposal: { id: stored.id, state: stored.stato, createdAt: stored.creata_il, type: proposalType, ...proposal }, capabilities: auth.capabilities };
  }
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const conversationId = await ensureConversation(auth.admin, auth.profile.id, body.conversationId, "pianificazione", criterion, body.topicId);
  const generationId = await startAIGeneration(auth.admin, {
    profileId: auth.profile.id,
    conversationId,
    type: proposalType,
    model,
  });
  let result;
  try {
    result = await generateText({
      model,
      system: `${systemPrompt("pianificazione", context)}\nGenera una simulazione strutturata. executable può essere true solo se tutti i dati e vincoli necessari sono presenti.`,
      ...(attachments.length ? { messages: [userModelMessage(criterion, attachments)] } : { prompt: criterion }),
      output: Output.object({ schema: PROPOSAL_SCHEMA }),
      maxOutputTokens: 2600,
      providerOptions: gatewayOptions(auth.profile.id, proposalType),
    });
  } catch (error) {
    await failAIGeneration(auth.admin, generationId, error);
    throw error;
  }
  const usage = await completeAIGeneration(auth.admin, { generationId, profileId: auth.profile.id, result });
  const proposal = result.output;
  const { data: stored, error } = await auth.admin.from("ai_proposte").insert({
    conversazione_id: conversationId,
    utente_id: auth.profile.id,
    tipo: proposalType,
    titolo: proposal.title,
    criterio: criterion,
    proposta: proposal,
  }).select("id,stato,creata_il").single();
  if (error) throw error;
  const answer = `${proposal.title}\n\n${proposal.summary}`;
  const storedAttachments = attachmentMetadata(attachments);
  await saveExchange(auth.admin, conversationId, displayedPrompt(criterion, attachments), answer, [], { proposalId: stored.id, proposalType, generationId, costUsd: usage.cost }, { attachments: storedAttachments });
  await auth.admin.from("ai_audit_log").insert({ utente_id: auth.profile.id, azione: "proposta_creata", entita_tipo: proposalType, entita_id: stored.id, dettagli: { executable: proposal.executable } });
  return { conversationId, answer, proposal: { id: stored.id, state: stored.stato, createdAt: stored.creata_il, type: proposalType, ...proposal }, usage, capabilities: auth.capabilities };
}

async function applyProgremesProposal(proposal) {
  if (String(process.env.PROGREMES_AI_PLANNING_ENABLED || "").toLowerCase() !== "true") {
    return { applied: false, connectorRequired: true, message: "Proposta approvata. Il connettore di pianificazione ProgreMES deve ancora essere abilitato." };
  }
  const url = new URL(String(process.env.PROGREMES_AI_APPLY_PATH || "/api/workspace/ai/planning/apply"), required("PROGREMES_URL"));
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Workspace-Secret": required("PROGREMES_INTEGRATION_SECRET") },
    body: JSON.stringify({ proposalId: proposal.id, criterion: proposal.criterio, proposal: proposal.proposta }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `ProgreMES ha risposto con stato ${response.status}.`);
  return { applied: true, message: "Piano inviato e applicato da ProgreMES.", details: payload };
}

async function decideProposal(auth, body) {
  if (!auth.capabilities.apply_plans) throw Object.assign(new Error("Approvazione dei piani non autorizzata."), { status: 403 });
  const proposalId = String(body.proposalId || "").trim();
  const decision = body.decision === "reject" ? "reject" : "approve";
  const { data: proposal, error } = await auth.admin.from("ai_proposte").select("*").eq("id", proposalId).eq("utente_id", auth.profile.id).maybeSingle();
  if (error || !proposal) throw Object.assign(new Error("Proposta non trovata o non autorizzata."), { status: 404 });
  if (proposal.stato !== "bozza") throw Object.assign(new Error("La proposta è già stata gestita."), { status: 409 });
  if (decision === "reject") {
    await auth.admin.from("ai_proposte").update({ stato: "rifiutata" }).eq("id", proposal.id);
    await auth.admin.from("ai_audit_log").insert({ utente_id: auth.profile.id, azione: "proposta_rifiutata", entita_tipo: proposal.tipo, entita_id: proposal.id });
    return { proposalId, state: "rifiutata", message: "Proposta rifiutata. Nessuna modifica è stata applicata." };
  }
  const approvedAt = new Date().toISOString();
  await auth.admin.from("ai_proposte").update({ stato: "approvata", approvata_il: approvedAt }).eq("id", proposal.id);
  let application = { applied: false, message: "Proposta approvata. Nessuna modifica automatica prevista per questo tipo di piano." };
  if (proposal.tipo === "piano_produzione") application = await applyProgremesProposal(proposal);
  const state = application.applied ? "applicata" : application.connectorRequired ? "connettore_richiesto" : "approvata";
  await auth.admin.from("ai_proposte").update({ stato: state, applicata_il: application.applied ? new Date().toISOString() : null }).eq("id", proposal.id);
  await auth.admin.from("ai_audit_log").insert({ utente_id: auth.profile.id, azione: application.applied ? "proposta_applicata" : "proposta_approvata", entita_tipo: proposal.tipo, entita_id: proposal.id, dettagli: application.details || {} });
  return { proposalId, state, ...application };
}

export async function handleAIAssistant(req) {
  if (req.method !== "POST") throw Object.assign(new Error("Metodo non consentito."), { status: 405 });
  const auth = await authorizeAIRequest(req);
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (body.action === "capabilities") return { capabilities: auth.capabilities };
  if (body.action === "list_conversations") return listConversations(auth);
  if (body.action === "create_topic") return createTopic(auth, body);
  if (body.action === "delete_conversation") return deleteConversation(auth, body);
  if (body.action === "delete_stale_conversations") return deleteStaleConversations(auth);
  if (body.action === "load_conversation") return loadConversation(auth, body);
  if (body.action === "list_autoplanning") return listAutoplanning(auth);
  if (body.action === "time_learning_review") return createProposal(auth, {
    ...body,
    automatic: true,
    prompt: "Verifica automatica dei tempi standard sulla base dei consuntivi ProgreMES.",
    proposalType: "piano_produzione",
  });
  if (body.action === "proposal") return createProposal(auth, body);
  if (body.action === "decide_proposal") return decideProposal(auth, body);
  return chat(auth, body);
}
