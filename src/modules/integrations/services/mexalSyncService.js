import { supabase } from "../../../lib/supabaseClient";

export async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data?.session?.access_token;
  if (!token) throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");
  return token;
}

async function invokeMexalApi(path, payload) {
  const token = await getAccessToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
  if (!response.ok) throw new Error(data?.error || `Errore Mexal (HTTP ${response.status})`);
  return data;
}

export async function invokeProductsSync(onProgress = () => {}) {
  let offset = 0;
  let syncRunId = null;
  const total = { processed: 0, inserted: 0, updated: 0, errors: [] };
  while (true) {
    const data = await invokeMexalApi("/api/mexal/sync-products", {
      action: "sync", offset, batchSize: 8, syncRunId, origin: "integrations",
    });
    syncRunId = data.sync_run_id || syncRunId;
    total.processed += Number(data.elaborati || 0);
    total.inserted += Number(data.inseriti || 0);
    total.updated += Number(data.aggiornati || 0);
    total.errors.push(...(data.errori || []));
    onProgress({ ...total, total: Number(data.totale || 0) });
    if (data.completato) return { ...total, syncRunId };
    const next = Number(data.prossimo_offset);
    if (!Number.isFinite(next) || next <= offset) throw new Error("Paginazione prodotti Mexal non valida.");
    offset = next;
  }
}

export async function invokeStocksSync(onProgress = () => {}) {
  let offset = 0; let syncRunId = null;
  const total = { processed: 0, updated: 0, errors: [] };
  while (true) {
    const data = await invokeMexalApi("/api/mexal/sync-products", { action: "sync-stock-it", offset, batchSize: 12, syncRunId, origin: "integrations" });
    syncRunId = data.sync_run_id || syncRunId;
    total.processed += Number(data.elaborati || 0); total.updated += Number(data.aggiornati || 0);
    total.errors.push(...(data.errori || [])); onProgress({ ...total, total: Number(data.totale || 0) });
    if (data.completato) return { ...total, syncRunId };
    const next = Number(data.prossimo_offset); if (!Number.isFinite(next) || next <= offset) throw new Error("Paginazione giacenze Mexal non valida.");
    offset = next;
  }
}

export async function invokeClientsSync() {
  return invokeMexalApi("/api/mexal/sync-clients", { action: "sync" });
}

export async function loadMexalRuns(type, limit = 1) {
  const { data, error } = await supabase
    .from("mexal_sync_runs")
    .select("id,sync_type,status,started_at,completed_at,processed,inserted,updated,skipped,failed,error_message,metadata")
    .eq("sync_type", type)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function loadMexalEntityCounts() {
  const [products, clients, stocks, orders] = await Promise.all([
    supabase.from("prodotti").select("*", { count: "exact", head: true }).eq("attivo_mexal", true).eq("mostra_in_app", true),
    supabase.from("ordini_clienti_cache").select("*", { count: "exact", head: true }).eq("attivo_mexal", true),
    supabase.from("prodotti").select("*", { count: "exact", head: true }).not("ultimo_sync_mexal", "is", null),
    supabase.from("ordini_testate").select("*", { count: "exact", head: true }).eq("stato_sincronizzazione", "non_inviato"),
  ]);
  return { products: products.error ? null : products.count || 0, clients: clients.error ? null : clients.count || 0, stocks: stocks.error ? null : stocks.count || 0, orders: orders.error ? null : orders.count || 0 };
}

export async function invokeCommercialConditionsSync(options = {}) {
  const payload = {
    mode: options.mode === "incremental" ? "incremental" : "full",
    dryRun: options.dryRun === true,
    syncPayments: options.syncPayments !== false,
  };

  const token = await getAccessToken();
  const response = await fetch("/api/mexal/sync-commercial-conditions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(raw || "Risposta Mexal non valida.");
  }

  if (!response.ok) {
    throw new Error(
      data?.error || raw || `Errore sincronizzazione Mexal (HTTP ${response.status})`
    );
  }

  if (!data?.ok) {
    throw new Error(data?.error || "La sincronizzazione Mexal non è stata completata");
  }

  return data;
}

export async function loadSyncRuns(limit = 25) {
  const { data, error } = await supabase.from("mexal_sync_runs")
    .select("id,sync_type,status,started_at,completed_at,processed,inserted,updated,skipped,failed,error_message,metadata")
    .order("started_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).map((run) => ({ ...run, records_read: run.processed, records_inserted: run.inserted, records_updated: run.updated, records_failed: run.failed, duration_ms: run.completed_at ? new Date(run.completed_at) - new Date(run.started_at) : null }));
}

export async function loadRunDetails(runId) {
  if (!runId) return { details: [], errors: [] };

  const [detailsResponse, errorsResponse] = await Promise.all([
    supabase
      .from("ordini_sync_run_details")
      .select(
        "id,run_id,entity_type,phase,status,records_read,records_written,records_deactivated,message,metadata,created_at"
      )
      .eq("run_id", runId)
      .order("created_at", { ascending: true }),
    supabase
      .from("ordini_sync_errors")
      .select(
        "id,run_id,entity_type,source_key,error_code,error_message,retryable,retry_count,resolved_at,created_at"
      )
      .eq("run_id", runId)
      .order("created_at", { ascending: true }),
  ]);

  if (detailsResponse.error) throw detailsResponse.error;
  if (errorsResponse.error) throw errorsResponse.error;

  return {
    details: detailsResponse.data || [],
    errors: errorsResponse.data || [],
  };
}

// These two tables belong to the older commercial-conditions pipeline, where
// run_id is UUID.  mexal_sync_runs.id is bigint: querying them with a run id
// such as 23 makes PostgREST cast "23" to UUID and breaks the whole dashboard.
export async function loadRunDetailsForRun(run) {
  if (!run?.id || run.sync_type !== "commercial_conditions") return { details: [], errors: [] };
  return loadRunDetails(run.id);
}

export async function loadCommercialCounts() {
  const requests = [
    ["matrix", "ordini_sconti_listini"],
    ["particularities", "ordini_particolarita"],
    ["payments", "ordini_regole_pagamento"],
  ];

  const results = await Promise.all(
    requests.map(async ([key, table]) => {
      const { count, error } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);

      return [key, error ? null : count || 0];
    })
  );

  return Object.fromEntries(results);
}
