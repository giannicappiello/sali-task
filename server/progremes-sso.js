/* global process */
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ensureProgremesCatalogFresh } from "./progremes-modules.js";
import { progremesDirectOperationalRoute } from "./progremes-sso-routes.js";

const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw Object.assign(new Error(`Variabile Vercel mancante: ${name}`), { status: 500 });
  return value;
};

function adminClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getWorkspaceIdentity(req, admin) {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) {
    throw Object.assign(new Error("Sessione Workspace mancante."), { status: 401 });
  }

  const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7));
  if (authError || !user) throw Object.assign(new Error("Sessione Workspace non valida."), { status: 401 });

  const { data: profile, error: profileError } = await admin
    .from("utenti")
    .select("id,email,attivo,reparto_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.attivo === false) {
    throw Object.assign(new Error("Utente Workspace non abilitato."), { status: 403 });
  }

  const { data: enabled, error: accessError } = await admin.rpc("workspace_module_enabled_for_user", {
    target_user_id: profile.id,
    target_module: "progremes",
  });
  if (accessError) throw accessError;
  if (enabled !== true) {
    throw Object.assign(new Error("Accesso al modulo ProgreMES non autorizzato."), { status: 403 });
  }

  const { data: adminAccess, error: adminError } = await admin.rpc("workspace_user_is_admin", {
    target_auth_user_id: user.id,
  });
  if (adminError) throw adminError;

  return { user, profile, isAdmin: adminAccess === true };
}

async function getAuthorizedProgremesCodes(admin, identity) {
  if (identity.isAdmin) return null;

  const { data: departmentRows, error: departmentsError } = await admin
    .from("utenti_reparti")
    .select("reparto_id")
    .eq("utente_id", identity.profile.id);
  if (departmentsError) throw departmentsError;

  const departmentIds = [...new Set([
    identity.profile.reparto_id,
    ...(departmentRows || []).map((row) => row.reparto_id),
  ].filter(Boolean))];
  if (!departmentIds.length) return new Set();

  const { data: accessRows, error: accessError } = await admin
    .from("progremes_reparti_moduli")
    .select("modulo_codice")
    .in("reparto_id", departmentIds);
  if (accessError) throw accessError;
  return new Set((accessRows || []).map((row) => row.modulo_codice));
}

export function progremesModuleCodeFromMetadata(metadata = {}) {
  const explicit = String(metadata?.external_module_code || "").trim();
  if (explicit) return explicit;
  return String(metadata?.external_code || "").trim().split(".")[0];
}

export function isProgremesScreenAuthorized(isAdmin, authorizedCodes, metadata) {
  return isAdmin || authorizedCodes?.has(progremesModuleCodeFromMetadata(metadata)) === true;
}

export function appendProgremesContext(returnUrl, context = {}) {
  if (!returnUrl?.startsWith("/") || returnUrl.startsWith("//")) return returnUrl;
  const allowed = { rdpId: "rdpId", octId: "octId", odpId: "odpId", article: "article", lot: "lot" };
  const url = new URL(returnUrl, "https://progremes.invalid");
  for (const [input, output] of Object.entries(allowed)) {
    const value = String(context?.[input] || "").trim();
    if (value && value.length <= 120) url.searchParams.set(output, value);
  }
  return `${url.pathname}${url.search}`;
}

export async function listUserProgremesSections(req) {
  const admin = adminClient();
  const identity = await getWorkspaceIdentity(req, admin);
  await ensureProgremesCatalogFresh(admin);
  const authorizedCodes = await getAuthorizedProgremesCodes(admin, identity);
  const [{ data: screens, error }, { data: links, error: linksError }] = await Promise.all([
    admin.from("workspace_schermate").select("codice,nome,descrizione,metadati").eq("provider", "progremes").eq("attiva", true),
    admin.from("workspace_moduli_schermate").select("schermata_codice,ordine").eq("modulo_codice", "progremes").eq("visibile_menu", true).order("ordine"),
  ]);
  if (error || linksError) throw error || linksError;
  const screenByCode = new Map((screens || []).map((screen) => [screen.codice, screen]));

  const sections = (links || [])
    .map((link) => ({ ...screenByCode.get(link.schermata_codice), moduleOrder: link.ordine }))
    .filter((screen) => screen.codice)
    .map((screen) => ({
      code: screen.codice,
      externalCode: String(screen.metadati?.external_code || screen.codice.replace(/^progremes\./, "")).trim(),
      moduleCode: progremesModuleCodeFromMetadata(screen.metadati),
      name: screen.nome,
      description: screen.descrizione || "Area operativa della gestione produzione.",
      order: screen.moduleOrder || 0,
    }))
    .filter((screen) => identity.isAdmin || authorizedCodes?.has(screen.moduleCode));

  return { sections };
}

export async function issueProgremesTicket(req, body = {}) {
  const admin = adminClient();
  const identity = await getWorkspaceIdentity(req, admin);
  await ensureProgremesCatalogFresh(admin);
  const { user, profile } = identity;
  if (!String(profile.email || user.email || "").trim()) {
    throw Object.assign(new Error("L'utente non dispone di un indirizzo email valido."), { status: 422 });
  }

  const screenCode = String(body?.screenCode || "").trim();
  let returnUrl = "";
  if (screenCode) {
    const directOperationalRoute = progremesDirectOperationalRoute(screenCode);
    const { data: moduleLinks, error: moduleLinkError } = await admin
      .from("workspace_moduli_schermate")
      .select("modulo_codice,schermata_codice")
      .eq("schermata_codice", screenCode)
      .eq("visibile_menu", true);
    if (moduleLinkError) throw moduleLinkError;
    const linkedModuleCodes = [...new Set((moduleLinks || []).map((link) => link.modulo_codice).filter(Boolean))];
    const { data: linkedModules, error: linkedModulesError } = linkedModuleCodes.length
      ? await admin.from("workspace_moduli").select("codice").in("codice", linkedModuleCodes).eq("attivo", true)
      : { data: [], error: null };
    if (linkedModulesError) throw linkedModulesError;
    if (!(linkedModules || []).length && !directOperationalRoute) {
      throw Object.assign(new Error("Schermata non inclusa in un modulo Workspace attivo."), { status: 404 });
    }
    const { data: screen, error: screenError } = await admin
      .from("workspace_schermate")
      .select("metadati")
      .eq("codice", screenCode)
      .eq("provider", "progremes")
      .eq("attiva", true)
      .maybeSingle();
    if (screenError) throw screenError;
    if (!screen) throw Object.assign(new Error("Schermata ProgreMES non disponibile."), { status: 404 });
    if (!identity.isAdmin) {
      const authorizedCodes = await getAuthorizedProgremesCodes(admin, identity);
      if (!isProgremesScreenAuthorized(identity.isAdmin, authorizedCodes, screen.metadati)) {
        throw Object.assign(new Error("Schermata ProgreMES non autorizzata."), { status: 403 });
      }
    }
    const requestedRoute = String(directOperationalRoute || screen.metadati?.external_route || "").trim();
    if (requestedRoute.startsWith("/") && !requestedRoute.startsWith("//")) returnUrl = appendProgremesContext(requestedRoute, body?.context);
  }

  const ticket = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(ticket).digest("hex");
  const ticketRecord = {
    token_hash: tokenHash,
    utente_id: profile.id,
    scade_il: new Date(Date.now() + 60_000).toISOString(),
  };
  if (screenCode) {
    ticketRecord.schermata_codice = screenCode;
    ticketRecord.percorso_destinazione = returnUrl;
  }
  const { error: ticketError } = await admin.from("progremes_sso_tickets").insert(ticketRecord);
  if (ticketError) throw ticketError;

  const destination = new URL("/Account/WorkspaceSso", required("PROGREMES_URL"));
  destination.searchParams.set("ticket", ticket);
  if (returnUrl) destination.searchParams.set("returnUrl", returnUrl);
  return { url: destination.toString() };
}

export async function consumeProgremesTicket(body) {
  const token = String(body?.ticket || "").trim();
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    throw Object.assign(new Error("Ticket non valido."), { status: 400 });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = adminClient();
  const { data, error } = await admin.rpc("consume_progremes_sso_ticket", {
    target_token_hash: tokenHash,
  });
  if (error) throw error;
  const profile = Array.isArray(data) ? data[0] : null;
  if (!profile) {
    throw Object.assign(new Error("Ticket non valido, scaduto o già utilizzato."), { status: 401 });
  }
  return profile;
}
