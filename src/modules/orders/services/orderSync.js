import { supabase } from "../../../lib/supabaseClient";

const STATUS_EVENT = "orders:background-sync-status";
const REQUEST_EVENT = "orders:background-sync-requested";

const CONFIG = {
  clienti: { intervalMinutes: 30, lockMinutes: 15 },
  giacenze: { intervalMinutes: 5, lockMinutes: 20 },
  prodotti: { intervalMinutes: 24 * 60, lockMinutes: 60 },
};

const running = new Map();

function emit(detail) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail }));
  }
}

async function getAccessToken() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) {
    throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");
  }
  return session.access_token;
}

async function postJson(url, body) {
  const token = await getAccessToken();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let result;
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = { error: text || "Risposta API non valida." };
  }

  if (!response.ok) {
    throw new Error(result.error || `Errore API (${response.status}).`);
  }
  return result;
}

async function claim(type, force = false) {
  const cfg = CONFIG[type];
  const { data, error } = await supabase.rpc("claim_ordini_sync", {
    p_tipo: type,
    p_intervallo_minuti: force ? 0 : cfg.intervalMinutes,
    p_lock_minuti: cfg.lockMinutes,
  });
  if (error) throw error;
  return data?.[0] || { esegui: false, motivo: "non_disponibile" };
}

async function complete(type, success, details = {}, errorMessage = null) {
  const { error } = await supabase.rpc("complete_ordini_sync", {
    p_tipo: type,
    p_successo: success,
    p_dettagli: details || {},
    p_errore: errorMessage,
  });
  if (error) console.error("Errore aggiornamento stato sincronizzazione:", error);
}

async function syncCustomers() {
  return postJson("/api/mexal/sync-clients", { action: "sync" });
}

async function syncStock() {
  let offset = 0;
  let updated = 0;
  const errors = [];

  while (true) {
    const result = await postJson("/api/mexal/sync-products", {
      action: "sync-stock-it",
      offset,
      batchSize: 12,
    });

    updated += Number(result.aggiornati || 0);
    if (Array.isArray(result.errori)) errors.push(...result.errori);

    emit({ type: "giacenze", running: true, updated, errors: errors.length });

    if (result.completato) break;
    const next = Number(result.prossimo_offset);
    offset = Number.isFinite(next) && next > offset ? next : offset + 12;
  }

  return { aggiornati: updated, errori: errors };
}

async function syncProducts() {
  let offset = 0;
  let inserted = 0;
  let updated = 0;
  let images = 0;
  const errors = [];

  while (true) {
    const result = await postJson("/api/mexal/sync-products", {
      action: "sync",
      offset,
      batchSize: 8,
      replaceStart: offset === 0,
    });

    inserted += Number(result.inseriti || 0);
    updated += Number(result.aggiornati || 0);
    images += Number(result.immagini_salvate || 0);
    if (Array.isArray(result.errori)) errors.push(...result.errori);

    emit({
      type: "prodotti",
      running: true,
      inserted,
      updated,
      images,
      errors: errors.length,
      processed: Number(result.prossimo_offset || 0),
      total: Number(result.totale || 0),
    });

    if (result.completato) break;
    const next = Number(result.prossimo_offset);
    offset = Number.isFinite(next) && next > offset ? next : offset + 8;
  }

  return { inseriti: inserted, aggiornati: updated, immagini: images, errori: errors };
}

const runners = {
  clienti: syncCustomers,
  giacenze: syncStock,
  prodotti: syncProducts,
};

export function startOrderSync(type, { force = false } = {}) {
  if (!CONFIG[type]) return Promise.reject(new Error(`Tipo sync non valido: ${type}`));
  if (running.has(type)) return running.get(type);

  const promise = (async () => {
    const claimResult = await claim(type, force);
    if (!claimResult.esegui) {
      emit({ type, running: false, skipped: true, reason: claimResult.motivo });
      return { skipped: true, reason: claimResult.motivo };
    }

    emit({ type, running: true, startedAt: new Date().toISOString() });

    try {
      const result = await runners[type]();
      const errorCount = Array.isArray(result?.errori) ? result.errori.length : 0;
      const success = errorCount === 0;
      await complete(type, success, result, success ? null : `${errorCount} errori`);
      emit({ type, running: false, success, completedAt: new Date().toISOString(), result });
      return result;
    } catch (error) {
      await complete(type, false, {}, error?.message || String(error));
      emit({ type, running: false, success: false, error: error?.message || String(error) });
      throw error;
    }
  })().finally(() => running.delete(type));

  running.set(type, promise);
  return promise;
}

export function startAutomaticOrderSyncs() {
  // L'avvio è volutamente non bloccante. Le sync già recenti vengono saltate dal DB.
  startOrderSync("giacenze").catch(() => {});
  startOrderSync("clienti").catch(() => {});
  startOrderSync("prodotti").catch(() => {});
}

export function requestOrderSync(type, options = {}) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: { type, options } }));
  }
  return startOrderSync(type, options);
}

export function subscribeToOrderSyncStatus(callback) {
  if (typeof window === "undefined") return () => {};
  const listener = (event) => callback(event.detail || {});
  window.addEventListener(STATUS_EVENT, listener);
  return () => window.removeEventListener(STATUS_EVENT, listener);
}

export function subscribeToOrderSyncRequests(callback) {
  if (typeof window === "undefined") return () => {};
  const listener = (event) => callback(event.detail || {});
  window.addEventListener(REQUEST_EVENT, listener);
  return () => window.removeEventListener(REQUEST_EVENT, listener);
}

// Dopo OCM/OCX: forza solo le giacenze, senza risincronizzare clienti o catalogo.
export function refreshStockAfterMexalOrder() {
  return startOrderSync("giacenze", { force: true });
}
