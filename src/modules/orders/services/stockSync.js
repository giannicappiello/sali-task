import { supabase } from "../../../lib/supabaseClient";

const STOCK_SYNC_EVENT = "orders:stock-sync-requested";
const STOCK_SYNC_STATUS_EVENT = "orders:stock-sync-status";
const DEFAULT_BATCH_SIZE = 12;

let runningPromise = null;

function publishStatus(detail) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(STOCK_SYNC_STATUS_EVENT, { detail })
    );
  }
}

async function callStockApi(body) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");
  }

  const response = await fetch("/api/mexal/sync-products", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
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

async function runStockSync() {
  let offset = 0;
  let updated = 0;
  const errors = [];

  publishStatus({
    running: true,
    updated: 0,
    errors: 0,
    message: "Aggiornamento disponibilità in corso...",
  });

  while (true) {
    const result = await callStockApi({
      action: "sync-stock-it",
      offset,
      batchSize: DEFAULT_BATCH_SIZE,
    });

    updated += Number(result.aggiornati || 0);
    errors.push(...(Array.isArray(result.errori) ? result.errori : []));

    publishStatus({
      running: true,
      updated,
      errors: errors.length,
      processed: Number(result.prossimo_offset || 0),
      total: Number(result.totale || 0),
      message: "Aggiornamento disponibilità in corso...",
    });

    if (result.completato) break;

    const nextOffset = Number(result.prossimo_offset);
    offset = Number.isFinite(nextOffset) && nextOffset > offset
      ? nextOffset
      : offset + DEFAULT_BATCH_SIZE;
  }

  const finalStatus = {
    running: false,
    updated,
    errors: errors.length,
    errorDetails: errors,
    completedAt: new Date().toISOString(),
    message:
      errors.length > 0
        ? `Disponibilità aggiornate con ${errors.length} errori.`
        : "Disponibilità aggiornate.",
  };

  publishStatus(finalStatus);
  return finalStatus;
}

export function startStockSync() {
  if (runningPromise) return runningPromise;

  runningPromise = runStockSync()
    .catch((error) => {
      const failedStatus = {
        running: false,
        updated: 0,
        errors: 1,
        error: error?.message || String(error),
        message: error?.message || "Errore aggiornamento disponibilità.",
      };

      console.error("Errore sincronizzazione disponibilità Mexal:", error);
      publishStatus(failedStatus);
      throw error;
    })
    .finally(() => {
      runningPromise = null;
    });

  return runningPromise;
}

export function requestStockSync() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(STOCK_SYNC_EVENT));
  }

  return startStockSync();
}

// Da richiamare subito dopo la conferma Mexal di un OCM o OCX.
export function refreshStockAfterMexalOrder() {
  return startStockSync();
}

export function subscribeToStockSyncRequest(callback) {
  if (typeof window === "undefined") return () => {};

  window.addEventListener(STOCK_SYNC_EVENT, callback);
  return () => window.removeEventListener(STOCK_SYNC_EVENT, callback);
}

export function subscribeToStockSyncStatus(callback) {
  if (typeof window === "undefined") return () => {};

  const listener = (event) => callback(event.detail || {});
  window.addEventListener(STOCK_SYNC_STATUS_EVENT, listener);
  return () => window.removeEventListener(STOCK_SYNC_STATUS_EVENT, listener);
}
