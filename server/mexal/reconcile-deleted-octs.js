// Never infer deletion from an absent collection row: lists can be filtered.
// Only a document GET with an explicit missing-resource response can retire it.
export function isConfirmedMissingOct(error) {
  const status = Number(error?.status || error?.mexalResponse?.status);
  if ([401, 403, 408, 429].includes(status) || status >= 500) return false;
  let body = error?.mexalResponse?.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return false; }
  }
  const details = body?.error;
  if (!details || typeof details !== "object") return false;
  const code = Number(details["response-code"] ?? details.code);
  const message = String(details["response-message"] || details["response-detail"] || "");
  return code === 1004 || ([404, 410].includes(status) && /not found|non trovat|inesistente/i.test(message));
}

export async function reconcileDeletedOcts({ mexal, supabase, moduleCode, year, importedKeys = new Set() }) {
  const sourceYear = Number(year);
  if (!Number.isInteger(sourceYear) || sourceYear < 2000 || sourceYear > 9999)
    return { retired_orders: 0, deletion_checks: 0, deletion_check_errors: 0, deletion_reconciliation: "skipped_missing_year" };
  let cursor = null;
  const candidates = [];
  // Keyset pagination: do not let the database row limit hide old OCTs.
  for (;;) {
    let query = supabase.from("ordini_testate")
      .select("id,mexal_sigla,mexal_serie,mexal_numero,mexal_chiave,mexal_anno,data_ordine,mexal_sincronizzato_il")
      .eq("origine", "mexal_oct").eq("mexal_cod_modulo", moduleCode)
      .is("mexal_eliminato_il", null).order("id").limit(200);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    candidates.push(...rows);
    if (rows.length < 200) break;
    const next = rows.at(-1).id;
    if (next === cursor) throw new Error("Paginazione OCT Workspace non valida.");
    cursor = next;
  }
  let retired = 0; let checked = 0; let failed = 0;
  for (const order of candidates) {
    const orderYear = Number(order.mexal_anno || String(order.data_ordine || "").slice(0, 4));
    if (orderYear !== sourceYear || order.mexal_sigla !== "OC"
      || !Number.isInteger(order.mexal_serie) || !Number.isInteger(order.mexal_numero)) continue;
    const key = `OC+${order.mexal_serie}+${order.mexal_numero}`;
    if (importedKeys.has(key)) continue;
    checked++;
    let missing = false;
    try {
      await mexal.getJson(`/documenti/ordini-clienti/${encodeURIComponent(key)}`);
    } catch (error) {
      missing = isConfirmedMissingOct(error);
      if (!missing) failed++;
    }
    if (!missing) continue;
    // Atomic retirement preserves source rows, RdP, MES lineage and CRM history.
    // The timestamp guard prevents a delayed check from retiring a fresh import.
    const { data, error } = await supabase.rpc("retire_deleted_mexal_oct", {
      p_order_id: order.id, p_module_code: moduleCode, p_year: sourceYear,
      p_source_key: key, p_seen_sync_at: order.mexal_sincronizzato_il || null,
    });
    if (error) throw error;
    if (data === true) retired++;
  }
  return { retired_orders: retired, deletion_checks: checked, deletion_check_errors: failed,
    deletion_reconciliation: failed ? "partial" : "completed" };
}
