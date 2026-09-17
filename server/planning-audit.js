// Read only the caller's planning outcomes. Never expose evidence payloads or other users' audits.
export async function planningVersionWithAudit(auth, version) {
  const { data, error } = await auth.scoped.from("ai_action_audit")
    .select("id,tool,status,error,occurred_at,confirmed_at,executed_at")
    .eq("user_id", auth.profile.id).eq("target", version.id)
    .in("tool", ["MES_PLAN_APPLY", "MES_ODL_VERIFY"])
    .order("occurred_at", { ascending: false }).limit(10);
  return { ...version, confirmationAttempts: data || [],
    auditError: error ? "Impossibile leggere l'esito delle conferme. Aggiornare il dettaglio prima di ripetere l'operazione." : null };
}
