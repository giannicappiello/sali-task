export async function notifyDigitalAdmins(db, connection, event, { cooldownHours = 6 } = {}) {
  const since = new Date(Date.now() - cooldownHours * 3600000).toISOString();
  const { data: duplicate } = await db.from("notifiche").select("id").eq("evento", event).contains("metadata", { connection_id: connection.id }).gte("created_at", since).limit(1);
  if (duplicate?.length) return { created: false, deduplicated: true };
  const { data: admins, error } = await db.from("utenti").select("id,ruoli!inner(amministratore_workspace,livello_accesso)").eq("attivo", true);
  if (error) throw error;
  const rows = (admins || []).filter((row) => row.ruoli?.amministratore_workspace || row.ruoli?.livello_accesso === "amministrazione").map((row) => ({
    utente_id: row.id, titolo: `Connessione Digital: ${connection.nome}`, messaggio: "La connessione richiede una verifica amministrativa.",
    tipo: "sistema", evento: event, url: "/settings/crm-digital", priorita: "alta",
    metadata: { connection_id: connection.id, provider_code: connection.provider_code, status: "error" },
  }));
  if (!rows.length) return { created: false };
  const { error: insertError } = await db.from("notifiche").insert(rows); if (insertError) throw insertError;
  return { created: true, count: rows.length };
}
