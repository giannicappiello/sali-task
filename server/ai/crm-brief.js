/* global process */
import { createClient } from "@supabase/supabase-js";
import { generateText, jsonSchema, Output } from "ai";

const DEFAULT_MODEL = "openai/gpt-5.6-luna";
const MODULE_BY_TYPE = Object.freeze({ conto_terzi: "crm_conto_terzi", b2b: "crm_b2b", online: "crm_online" });
const LEVEL_RANK = Object.freeze({ nessuno: 0, lettura: 1, scrittura: 2, amministrazione: 3 });

const STRATEGIC_PLAN_SCHEMA = jsonSchema({
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "strategy", "questions", "alternatives", "risks", "readyForApproval", "project", "phases"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    strategy: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
    alternatives: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    readyForApproval: { type: "boolean" },
    project: {
      type: "object", additionalProperties: false,
      required: ["title", "description", "objectives", "priority", "deadline"],
      properties: {
        title: { type: "string" }, description: { type: "string" }, objectives: { type: "array", items: { type: "string" } },
        priority: { type: "string" }, deadline: { type: ["string", "null"] },
      },
    },
    phases: {
      type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["title", "description", "department", "owner", "priority", "deadline", "dependencies", "tasks"],
        properties: {
          title: { type: "string" }, description: { type: "string" }, department: { type: ["string", "null"] }, owner: { type: ["string", "null"] },
          priority: { type: "string" }, deadline: { type: ["string", "null"] }, dependencies: { type: "array", items: { type: "string" } },
          tasks: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "description", "owner", "deadline", "checklist"], properties: { title: { type: "string" }, description: { type: "string" }, owner: { type: ["string", "null"] }, deadline: { type: ["string", "null"] }, checklist: { type: "array", items: { type: "string" } } } } },
        },
      },
    },
  },
});

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw Object.assign(new Error(`Variabile Vercel mancante: ${name}`), { status: 500 });
  return value;
}

function bearer(req) {
  const value = String(req.headers.authorization || "");
  if (!value.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  return value.slice(7).trim();
}

function adminClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
}

function userClient(token) {
  const key = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
  return createClient(required("SUPABASE_URL"), key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
}

async function authorize(req, crmType = null, requiredLevel = "scrittura") {
  const token = bearer(req); const admin = adminClient(); const scoped = userClient(token);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData?.user?.id) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  const { data: profile, error: profileError } = await admin.from("utenti").select("id,nome,cognome,attivo,ruoli(amministratore_workspace,livello_ai)").eq("auth_user_id", authData.user.id).maybeSingle();
  if (profileError || !profile || profile.attivo === false) throw Object.assign(new Error("Profilo Workspace non valido."), { status: 403 });
  const { data: access, error: accessError } = await scoped.rpc("workspace_access_context");
  if (accessError) throw accessError;
  const isAdmin = profile.ruoli?.amministratore_workspace === true;
  const requiredModules = ["crm_ai", crmType ? MODULE_BY_TYPE[crmType] : null].filter(Boolean);
  const requiredRank = LEVEL_RANK[requiredLevel] || 2;
  for (const moduleCode of requiredModules) {
    const allowed = isAdmin || (access?.modules || []).includes(moduleCode);
    const level = isAdmin ? "amministrazione" : access?.module_levels?.[moduleCode] || "nessuno";
    if (!allowed || (LEVEL_RANK[level] || 0) < requiredRank) throw Object.assign(new Error(`Accesso ${moduleCode} non autorizzato.`), { status: 403 });
  }
  if (!isAdmin && profile.ruoli?.livello_ai === "nessuno") throw Object.assign(new Error("Funzioni AI non abilitate per il ruolo."), { status: 403 });
  return { token, admin, scoped, profile, access, isAdmin };
}

async function queryRows(query, label) {
  const { data, error } = await query;
  if (error) return { label, unavailable: error.message, rows: [] };
  return { label, rows: data || [] };
}

async function buildAuthorizedContext(auth, crmType, accountId) {
  const queries = [
    queryRows(auth.scoped.from("crm_accounts").select("id,nome,stato,stato_relazione,valore_cliente,segmenti,codice_cliente_mexal,ultima_attivita_il,prossima_attivita_il").eq("tipo", crmType).limit(80), "accounts"),
    queryRows(auth.scoped.from("crm_opportunities").select("id,titolo,valore,probabilita,chiusura_prevista,crm_accounts!inner(nome,tipo),crm_opportunity_stages(nome,finale,vinta)").eq("crm_accounts.tipo", crmType).limit(100), "opportunities"),
    queryRows(auth.scoped.from("crm_activities").select("tipo,titolo,stato,data_attivita").eq("crm_tipo", crmType).order("data_attivita", { ascending: false }).limit(100), "activities"),
    queryRows(auth.scoped.from("crm_briefs").select("titolo,stato,obiettivo,target,categoria,budget:dati->budget").eq("crm_tipo", crmType).limit(60), "briefs"),
    queryRows(auth.scoped.from("prodotti").select("id,codice,nome,brand,categoria").eq("attivo", true).limit(100), "products"),
  ];
  if (crmType === "online") queries.push(queryRows(auth.scoped.from("crm_campaigns").select("nome,obiettivo,canale,target,budget,data_inizio,data_fine,stato,kpi_target,kpi_effettivi").limit(80), "campaigns"), queryRows(auth.scoped.from("crm_creators").select("nome,piattaforma,nicchia,follower,stato_collaborazione,costi,vendite_attribuite").limit(80), "creators"));
  if (accountId) queries.push(queryRows(auth.scoped.from("crm_accounts").select("*").eq("id", accountId).eq("tipo", crmType).limit(1), "selectedAccount"));
  if ((auth.access?.modules || []).includes("attivita") || auth.isAdmin) queries.push(queryRows(auth.scoped.from("v4_progetti").select("titolo,descrizione,deadline,stato").order("created_at", { ascending: false }).limit(50), "workspaceProjects"));
  const results = await Promise.all(queries);
  return Object.fromEntries(results.map((item) => [item.label, item.unavailable ? { unavailable: item.unavailable } : item.rows]));
}

function systemPrompt(crmType, context) {
  return `Sei AI Business Assistant di Progre Workspace, specializzato nel CRM ${crmType}.
Usa esclusivamente il contesto autorizzato fornito. Non dedurre dati personali o commerciali assenti.
Prima di dichiarare readyForApproval=true verifica obiettivo, target, budget, scadenza, vincoli e responsabilita. Se mancano, inserisci domande concise e readyForApproval=false.
Proponi alternative e rischi. Il piano deve essere operativo ma non applicato: la decisione resta umana.
Non inventare KPI o fonti. Le fasi saranno trasformate in fasi progetto Workspace e i task in ulteriori fasi operative/reminder.
Contesto autorizzato:\n${JSON.stringify(context)}`;
}

async function ensureBrief(auth, body, crmType, prompt) {
  const requestedId = String(body.briefId || "").trim();
  if (requestedId) {
    const { data, error } = await auth.scoped.from("crm_briefs").select("*").eq("id", requestedId).eq("crm_tipo", crmType).maybeSingle();
    if (error || !data) throw Object.assign(new Error("Brief non trovato o non autorizzato."), { status: 404 });
    return data;
  }
  const title = prompt.split(/[.!?\n]/)[0].trim().slice(0, 120) || "Nuovo brief strategico";
  const { data, error } = await auth.scoped.from("crm_briefs").insert({ crm_tipo: crmType, titolo: title, stato: "in_analisi", account_id: body.accountId || null, responsabile_id: auth.profile.id, creato_da: auth.profile.id }).select("*").single();
  if (error) throw error;
  return data;
}

async function analyze(auth, body, crmType) {
  const prompt = String(body.prompt || "").trim().slice(0, 12000);
  if (!prompt) throw Object.assign(new Error("Descrivi l'obiettivo strategico."), { status: 400 });
  const brief = await ensureBrief(auth, body, crmType, prompt);
  const { data: history, error: historyError } = await auth.scoped.from("crm_brief_messages").select("ruolo,contenuto").eq("brief_id", brief.id).order("creato_il").limit(30);
  if (historyError) throw historyError;
  const context = await buildAuthorizedContext(auth, crmType, brief.account_id || body.accountId || null);
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const messages = [...(history || []).map((item) => ({ role: item.ruolo === "assistant" ? "assistant" : "user", content: item.contenuto })), { role: "user", content: prompt }];
  const result = await generateText({ model, system: systemPrompt(crmType, context), messages, output: Output.object({ schema: STRATEGIC_PLAN_SCHEMA }), maxOutputTokens: 3600, providerOptions: { gateway: { user: auth.profile.id, metadata: { feature: "crm-strategic-brief", crmType } } } });
  const plan = result.output;
  const versionResult = await auth.scoped.from("crm_ai_decisions").select("versione").eq("brief_id", brief.id).order("versione", { ascending: false }).limit(1);
  const version = Number(versionResult.data?.[0]?.versione || 0) + 1;
  const [{ error: userMessageError }, { error: assistantMessageError }, decisionResult] = await Promise.all([
    auth.scoped.from("crm_brief_messages").insert({ brief_id: brief.id, ruolo: "user", contenuto: prompt, creato_da: auth.profile.id }),
    auth.scoped.from("crm_brief_messages").insert({ brief_id: brief.id, ruolo: "assistant", contenuto: `${plan.summary}\n\n${plan.strategy}`, metadati: { model }, creato_da: auth.profile.id }),
    auth.scoped.from("crm_ai_decisions").insert({ brief_id: brief.id, versione: version, titolo: plan.title, riepilogo: plan.summary, piano: plan, creata_da: auth.profile.id }).select("id,titolo,riepilogo,piano,stato").single(),
  ]);
  if (userMessageError || assistantMessageError || decisionResult.error) throw userMessageError || assistantMessageError || decisionResult.error;
  await auth.scoped.from("crm_briefs").update({ stato: plan.readyForApproval ? "decisione_proposta" : "in_analisi", piano_corrente: plan }).eq("id", brief.id);
  await auth.scoped.from("crm_audit_log").insert({ utente_id: auth.profile.id, entita_tipo: "brief", entita_id: brief.id, operazione: "piano_ai_proposto", dettagli: { decision_id: decisionResult.data.id, ready: plan.readyForApproval } });
  const allMessages = [...(history || []).map((item) => ({ role: item.ruolo, content: item.contenuto })), { role: "user", content: prompt }, { role: "assistant", content: `${plan.summary}\n\n${plan.strategy}` }];
  return { briefId: brief.id, messages: allMessages, decision: { id: decisionResult.data.id, title: plan.title, summary: plan.summary, plan } };
}

async function applyPlan(auth, brief, decision) {
  const plan = decision.piano;
  if (plan.readyForApproval !== true) throw Object.assign(new Error("Il piano contiene ancora informazioni mancanti."), { status: 409 });
  const activitiesLevel = auth.isAdmin ? "amministrazione" : auth.access?.module_levels?.attivita || "nessuno";
  if (!auth.isAdmin && (!(auth.access?.modules || []).includes("attivita") || (LEVEL_RANK[activitiesLevel] || 0) < LEVEL_RANK.scrittura)) {
    throw Object.assign(new Error("Per creare il progetto serve il livello scrittura nel modulo Attività."), { status: 403 });
  }
  const { data, error } = await auth.scoped.rpc("crm_apply_ai_decision", {
    target_brief_id: brief.id,
    target_decision_id: decision.id,
  });
  if (error) throw error;
  return data;
}

async function approve(auth, body) {
  const briefId = String(body.briefId || ""); const decisionId = String(body.decisionId || "");
  const [{ data: brief, error: briefError }, { data: decision, error: decisionError }] = await Promise.all([auth.scoped.from("crm_briefs").select("*").eq("id", briefId).maybeSingle(), auth.scoped.from("crm_ai_decisions").select("*").eq("id", decisionId).eq("brief_id", briefId).maybeSingle()]);
  if (briefError || decisionError || !brief || !decision) throw Object.assign(new Error("Decisione non trovata o non autorizzata."), { status: 404 });
  if (decision.stato !== "proposta" && !(decision.stato === "applicata" && decision.progetto_id)) throw Object.assign(new Error("La decisione è già stata gestita."), { status: 409 });
  return { application: await applyPlan(auth, brief, decision) };
}

export async function handleCrmBrief(req) {
  if (req.method !== "POST") throw Object.assign(new Error("Metodo non consentito."), { status: 405 });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (body.action === "approve") {
    const preliminary = await authorize(req, null, "scrittura");
    const briefResult = await preliminary.scoped.from("crm_briefs").select("crm_tipo").eq("id", String(body.briefId || "")).maybeSingle();
    if (briefResult.error || !briefResult.data) throw Object.assign(new Error("Brief non trovato."), { status: 404 });
    return approve(await authorize(req, briefResult.data.crm_tipo, "scrittura"), body);
  }
  const crmType = MODULE_BY_TYPE[body.crmType] ? body.crmType : "conto_terzi";
  return analyze(await authorize(req, crmType, "scrittura"), body, crmType);
}
