import { supabase } from "../../../lib/supabaseClient";

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data?.session?.access_token;
  if (!token) throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");
  return token;
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
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
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
  const { data, error } = await supabase
    .from("ordini_sync_runs")
    .select(
      "id,sync_type,source_system,status,requested_by,started_at,completed_at,duration_ms,records_read,records_inserted,records_updated,records_deactivated,records_failed,warning_count,parameters,summary,error_message"
    )
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
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
