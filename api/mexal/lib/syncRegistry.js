/** Shared sync handler registry. Handlers use the uniform server-side request contract. */
export const syncRegistry = Object.freeze({
  clients: { path: "/api/mexal/sync-clients", body: { action: "sync" } },
  products: { path: "/api/mexal/sync-products", body: { action: "sync", offset: 0, batchSize: 8 } },
  stocks: { path: "/api/mexal/sync-products", body: { action: "sync-stock-it", offset: 0, batchSize: 12 } },
  commercial_conditions: { path: "/api/mexal/sync-commercial-conditions", body: { mode: "incremental", syncPayments: true } },
  document_series: { path: "/api/mexal/sync-document-series", body: {} },
});
export async function runRegisteredSync({ syncType, source = "manual", context = {}, dryRun = false, authorization, baseUrl, fetchImpl = fetch }) {
  const definition = syncRegistry[syncType];
  if (!definition) throw new Error(`Tipo sincronizzazione non supportato: ${syncType}`);
  if (dryRun) return { success: true, syncType, dryRun: true };
  let body = { ...definition.body, origin: source, context };
  let data;
  // Products and stocks are intentionally batched.  Event/cron callers used
  // to invoke only offset 0, leaving the central run forever "running".
  do {
    const response = await fetchImpl(`${baseUrl}${definition.path}`, { method: "POST", headers: { "content-type": "application/json", authorization }, body: JSON.stringify(body) });
    data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false || data.ok === false) throw new Error(data.error || `Sincronizzazione non riuscita (HTTP ${response.status}).`);
    if (!["products", "stocks"].includes(syncType) || data.completato) break;
    const next = Number(data.prossimo_offset);
    if (!Number.isFinite(next) || next <= Number(body.offset || 0)) throw new Error("Paginazione Mexal non valida.");
    body = { ...body, offset: next, syncRunId: data.sync_run_id };
  } while (true);
  return { success: true, syncType, ...data };
}
