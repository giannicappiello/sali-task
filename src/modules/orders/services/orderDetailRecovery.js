// Reading an order must not depend on a maintenance request to Mexal sync.
// loadDetail always uses the caller's Supabase session and database RLS.
export async function loadOrderWithRecovery({ loadDetail, recoverSync, moduleCode, canRecover }) {
  const result = await loadDetail();
  if (!canRecover || moduleCode === "ph" || !["in_corso", "arresto_richiesto"].includes(result.order?.stato_sincronizzazione)) return result;
  let recovery;
  try { recovery = await recoverSync(); }
  catch (error) { return { ...result, syncRecoveryError: error }; }
  return recovery?.recovered ? loadDetail() : result;
}
