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
  const response = await fetchImpl(`${baseUrl}${definition.path}`, { method: "POST", headers: { "content-type": "application/json", authorization }, body: JSON.stringify({ ...definition.body, origin: source, context }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false || data.ok === false) throw new Error(data.error || `Sincronizzazione non riuscita (HTTP ${response.status}).`);
  return { success: true, syncType, ...data };
}
