export async function loadDepartmentMembers(db, departmentId) {
  if (!departmentId || departmentId === "new") return [];
  const department = await db.from("reparti").select("workspace_hr").eq("id", departmentId).single();
  if (department.error) throw department.error;
  const memberships = department.data?.workspace_hr
    ? await db.from("workspace_hr_members").select("utente_id:user_id").eq("active", true)
    : await db.from("utenti_reparti").select("utente_id").eq("reparto_id", departmentId);
  if (memberships.error) throw memberships.error;
  const ids = [...new Set((memberships.data || []).map((row) => row.utente_id).filter(Boolean))];
  if (!ids.length) return [];
  const users = await db.from("utenti")
    .select("id,nome,cognome,email,attivo,ruoli(nome)")
    .in("id", ids).order("nome").order("cognome");
  if (users.error) throw users.error;
  return users.data || [];
}
