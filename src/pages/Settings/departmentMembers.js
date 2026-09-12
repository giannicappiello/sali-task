export async function loadDepartmentMembers(db, departmentId) {
  if (!departmentId || departmentId === "new") return [];
  const memberships = await db.from("utenti_reparti").select("utente_id").eq("reparto_id", departmentId);
  if (memberships.error) throw memberships.error;
  const ids = [...new Set((memberships.data || []).map((row) => row.utente_id).filter(Boolean))];
  if (!ids.length) return [];
  const users = await db.from("utenti")
    .select("id,nome,cognome,email,attivo,ruoli(nome)")
    .in("id", ids).order("nome").order("cognome");
  if (users.error) throw users.error;
  return users.data || [];
}
