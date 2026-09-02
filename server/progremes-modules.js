import { requirePermission } from "./mexal/lib/auth.js";

export const PROGREMES_SYNC_TIMEOUT_MS = 30 * 60 * 1000;
const ACTIVE_RUN_STATES = ["in_coda", "in_esecuzione"];
const STOPPED_MESSAGE = "Sincronizzazione arrestata manualmente dall’amministratore.";
const TIMEOUT_MESSAGE = "Run chiusa automaticamente dopo 30 minuti senza completamento.";

const required = (name) => {
  const value = String(globalThis.process?.env?.[name] || "").trim();
  if (!value) throw Object.assign(new Error(`Variabile Vercel mancante: ${name}`), { status: 500 });
  return value;
};

export async function listProgremesIntegration(req, supabase) {
  await requirePermission(req, supabase, ["integrations.configure", "integrations.sync.progremes_modules"]);
  await cleanupStaleProgremesRuns(supabase);
  const [modules, screens, runs, config] = await Promise.all([
    supabase.from("progremes_moduli").select("*").order("ordine").order("nome"),
    supabase.from("workspace_schermate").select("codice,nome,descrizione,percorso,attiva,ordine,ultima_sincronizzazione").eq("provider", "progremes").order("ordine").order("nome"),
    supabase.from("progremes_sync_runs").select("*").order("iniziata_il", { ascending: false }).limit(30),
    supabase.from("progremes_sync_config").select("*").eq("id", 1).single(),
  ]);
  if (modules.error || screens.error || runs.error || config.error) throw modules.error || screens.error || runs.error || config.error;
  return { modules: modules.data, screens: screens.data, runs: runs.data, config: config.data };
}

export async function cleanupStaleProgremesRuns(supabase, now = new Date()) {
  const completedAt = now.toISOString();
  const cutoff = new Date(now.getTime() - PROGREMES_SYNC_TIMEOUT_MS).toISOString();
  const [stopped, timedOut] = await Promise.all([
    supabase.from("progremes_sync_runs").update({
      stato: "arrestata",
      completata_il: completedAt,
      errore: STOPPED_MESSAGE,
    }).in("stato", ACTIVE_RUN_STATES).eq("arresto_richiesto", true).lt("iniziata_il", cutoff),
    supabase.from("progremes_sync_runs").update({
      stato: "errore",
      completata_il: completedAt,
      errore: TIMEOUT_MESSAGE,
    }).in("stato", ACTIVE_RUN_STATES).eq("arresto_richiesto", false).lt("iniziata_il", cutoff),
  ]);
  if (stopped.error || timedOut.error) throw stopped.error || timedOut.error;
}

export function normalizeProgremesCatalog(payload, now = new Date().toISOString()) {
  const sourceModules = Array.isArray(payload?.modules) ? payload.modules : [];
  const sourceScreens = Array.isArray(payload?.screens)
    ? payload.screens
    : Array.isArray(payload?.pages)
      ? payload.pages
      : sourceModules;
  const normalizeItem = (item, index) => ({
    code: String(item?.code || "").trim(),
    name: String(item?.name || item?.code || "").trim(),
    description: String(item?.description || "").trim() || null,
    route: String(item?.route || "/").trim(),
    group: String(item?.group || "ProgreMES").trim(),
    active: item?.active !== false,
    order: Number(item?.order) || index + 1,
    moduleCode: String(item?.moduleCode || item?.module_code || item?.code || "").trim(),
  });
  const modules = sourceModules.map(normalizeItem).filter((item) => item.code);
  const screens = sourceScreens.map(normalizeItem).filter((item) => item.code);
  return {
    modules: modules.map((item) => ({
      codice: item.code,
      nome: item.name,
      descrizione: item.description,
      percorso: item.route,
      attivo: item.active,
      ordine: item.order,
      ultima_sincronizzazione: now,
    })),
    screens: screens.map((item) => {
      const screenCode = item.code.startsWith("progremes.") ? item.code : `progremes.${item.code}`;
      return {
        codice: screenCode,
        nome: item.name,
        descrizione: item.description,
        provider: "progremes",
        percorso: `/produzione/${encodeURIComponent(screenCode)}`,
        chiave_componente: null,
        protetta: false,
        attiva: item.active,
        ordine: item.order,
        metadati: {
          external_code: item.code,
          external_module_code: item.moduleCode,
          external_route: item.route,
          group: item.group,
          catalog_source: "progremes_catalog",
        },
        ultima_sincronizzazione: now,
      };
    }),
  };
}

export async function saveProgremesSyncConfig(req, supabase, body) {
  await requirePermission(req, supabase, ["integrations.configure"]);
  const enabled = body.sincronizzazione_automatica === true;
  const interval = Math.max(1, Math.min(168, Number(body.intervallo_ore) || 24));
  const { data, error } = await supabase.from("progremes_sync_config").update({
    sincronizzazione_automatica: enabled,
    intervallo_ore: interval,
    prossima_esecuzione: enabled ? new Date(Date.now() + interval * 3600000).toISOString() : null,
    aggiornato_il: new Date().toISOString(),
  }).eq("id", 1).select().single();
  if (error) throw error;
  return { config: data };
}

export async function syncProgremesModules(req, supabase, origin = "manuale", skipPermissionCheck = false) {
  if (!skipPermissionCheck) await requirePermission(req, supabase, ["integrations.configure", "integrations.sync.progremes_modules"]);
  await cleanupStaleProgremesRuns(supabase);
  const { data: running, error: runningError } = await supabase.from("progremes_sync_runs").select("id").in("stato", ACTIVE_RUN_STATES).limit(1).maybeSingle();
  if (runningError) throw runningError;
  if (running) throw Object.assign(new Error("Sincronizzazione moduli ProgreMES già in esecuzione."), { status: 409 });
  const { data: run, error: runError } = await supabase.from("progremes_sync_runs").insert({ origine: origin, stato: "in_esecuzione" }).select().single();
  if (runError) throw runError;
  try {
    const response = await fetch(new URL("/api/workspace/modules", required("PROGREMES_URL")), {
      headers: { "X-Workspace-Secret": required("PROGREMES_INTEGRATION_SECRET") },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`ProgreMES ha risposto con stato ${response.status}.`);
    const payload = await response.json();
    const { data: runState } = await supabase.from("progremes_sync_runs").select("stato,arresto_richiesto").eq("id", run.id).single();
    if (runState?.arresto_richiesto || !ACTIVE_RUN_STATES.includes(runState?.stato)) {
      const stoppedAt = new Date().toISOString();
      await supabase.from("progremes_sync_runs").update({ stato: "arrestata", completata_il: stoppedAt, errore: STOPPED_MESSAGE }).eq("id", run.id).in("stato", ACTIVE_RUN_STATES);
      return { runId: run.id, stopped: true };
    }
    const now = new Date().toISOString();
    const catalog = normalizeProgremesCatalog(payload, now);
    const codes = catalog.modules.map((item) => item.codice);
    const [{ data: existing, error: existingError }, { data: existingScreens, error: existingScreensError }] = await Promise.all([
      supabase.from("progremes_moduli").select("codice,nome,descrizione,percorso,attivo,ordine"),
      supabase.from("workspace_schermate").select("codice,metadati").eq("provider", "progremes"),
    ]);
    if (existingError || existingScreensError) throw existingError || existingScreensError;
    const before = new Map(existing.map((item) => [item.codice, item]));
    const normalized = catalog.modules;
    if (normalized.length) {
      const { error } = await supabase.from("progremes_moduli").upsert(normalized, { onConflict: "codice" });
      if (error) throw error;
    }
    const normalizedScreens = catalog.screens;
    if (normalizedScreens.length) {
      const { error } = await supabase.from("workspace_schermate").upsert(normalizedScreens, { onConflict: "codice" });
      if (error) throw error;
    }
    const screenCodes = new Set(normalizedScreens.map((item) => item.codice));
    const removedScreens = (existingScreens || [])
      .filter((item) => item.metadati?.catalog_source === "progremes_catalog" && !screenCodes.has(item.codice))
      .map((item) => item.codice);
    if (removedScreens.length) {
      const { error } = await supabase.from("workspace_schermate")
        .update({ attiva: false, ultima_sincronizzazione: now })
        .in("codice", removedScreens);
      if (error) throw error;
    }
    const removed = existing.filter((item) => !codes.includes(item.codice)).map((item) => item.codice);
    if (removed.length) {
      const { error } = await supabase.from("progremes_moduli").update({ attivo: false, ultima_sincronizzazione: now }).in("codice", removed);
      if (error) throw error;
    }
    const inserted = normalized.filter((item) => !before.has(item.codice)).length;
    const updated = normalized.length - inserted;
    const { data: completedRun, error: completedRunError } = await supabase.from("progremes_sync_runs").update({ stato: "completata", completata_il: now, moduli_letti: normalized.length, inseriti: inserted, aggiornati: updated, disattivati: removed.length, dettagli: { source: payload.source, version: payload.version, screens_disabled: removedScreens.length } }).eq("id", run.id).eq("stato", "in_esecuzione").select("id").maybeSingle();
    if (completedRunError) throw completedRunError;
    if (!completedRun) return { runId: run.id, stopped: true };
    const { data: syncConfig } = await supabase.from("progremes_sync_config").select("intervallo_ore").eq("id", 1).single();
    const intervalHours = Math.max(1, Number(syncConfig?.intervallo_ore) || 24);
    await supabase.from("progremes_sync_config").update({ ultima_esecuzione: now, prossima_esecuzione: new Date(Date.now() + intervalHours * 3600000).toISOString(), aggiornato_il: now }).eq("id", 1);
    return { runId: run.id, processed: normalized.length, screens: normalizedScreens.length, inserted, updated, disabled: removed.length, screensDisabled: removedScreens.length };
  } catch (error) {
    await supabase.from("progremes_sync_runs").update({ stato: "errore", completata_il: new Date().toISOString(), errore: error.message }).eq("id", run.id).in("stato", ACTIVE_RUN_STATES);
    throw error;
  }
}

export async function ensureProgremesCatalogFresh(supabase, force = false) {
  const { data: config, error } = await supabase
    .from("progremes_sync_config")
    .select("ultima_esecuzione")
    .eq("id", 1)
    .single();
  if (error) throw error;
  const maxAgeMinutes = 5;
  const lastRun = config?.ultima_esecuzione ? Date.parse(config.ultima_esecuzione) : 0;
  if (!force && lastRun && Date.now() - lastRun < maxAgeMinutes * 60_000) {
    return { refreshed: false, fresh: true };
  }
  try {
    const result = await syncProgremesModules(null, supabase, "automatica", true);
    return { refreshed: true, ...result };
  } catch (error) {
    if (Number(error?.status) === 409) return { refreshed: false, running: true };
    return { refreshed: false, stale: true, error: error?.message || String(error) };
  }
}

export async function runAutomaticProgremesModuleSync(supabase) {
  const { data: config, error } = await supabase.from("progremes_sync_config").select("*").eq("id", 1).single();
  if (error) throw error;
  if (!config.sincronizzazione_automatica || (config.prossima_esecuzione && Date.parse(config.prossima_esecuzione) > Date.now())) return { due: false };
  return { due: true, ...(await ensureProgremesCatalogFresh(supabase, true)) };
}

export async function stopProgremesModulesSync(req, supabase) {
  await requirePermission(req, supabase, ["integrations.configure", "integrations.sync.progremes_modules"]);
  await cleanupStaleProgremesRuns(supabase);
  const { data: run, error } = await supabase.from("progremes_sync_runs").select("id").in("stato", ACTIVE_RUN_STATES).order("iniziata_il", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!run) return { stopped: false };
  const stoppedAt = new Date().toISOString();
  const { error: updateError } = await supabase.from("progremes_sync_runs").update({
    arresto_richiesto: true,
    stato: "arrestata",
    completata_il: stoppedAt,
    errore: STOPPED_MESSAGE,
  }).eq("id", run.id).in("stato", ACTIVE_RUN_STATES);
  if (updateError) throw updateError;
  return { stopped: true, runId: run.id };
}
