/* global process */
import {createClient} from '@supabase/supabase-js';
import {workspaceAuthFailure} from '../workspace-auth-diagnostic.js';
function progremesDataAvailable() {
  return String(process.env.PROGREMES_AI_PLANNING_ENABLED || "").toLowerCase() === "true";
}

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

export async function authorizeAIRequest(req, { bypassAIEntitlements = false } = {}) {
  const token = bearerToken(req);
  const admin = adminClient();
  const scoped = userClient(token);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData?.user?.id) throw workspaceAuthFailure(authError, bypassAIEntitlements ? 'planning-workspace' : 'ai', "Sessione non valida.");

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
    role_ai_level: "conferma",
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
    runtime: 'second-brain-progre',
    progremes_data: baseCapabilities.progremes === true && progremesDataAvailable(),
  };
  if (!bypassAIEntitlements && capabilities.module_access !== true) {
    throw Object.assign(new Error("Accesso al modulo Assistente AI non autorizzato."), { status: 403 });
  }
  return { token, admin, scoped, profile, access, capabilities, developmentPermissions: {} };
}

