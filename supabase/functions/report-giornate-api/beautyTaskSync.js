export async function syncBeautyDayTasks(primary, report, rows, actorId, deleted = false) {
  const days = Array.isArray(rows) ? rows : rows ? [rows] : [];
  for (const saved of days) {
    // Always use the persisted day, even if the caller only selected its id.
    const dayResult = deleted ? { data: saved } : await report.from('giornate_promozionali')
      .select('id,farmacia_id,consultant_id,data,ora_inizio,ora_fine,stato,tipo_giornata').eq('id',saved.id).single();
    if (dayResult.error) throw dayResult.error;
    const day = dayResult.data;
    if (!day) throw new Error('Giornata salvata non disponibile per il collegamento alle task.');
    const [client, consultant] = await Promise.all([
      report.from('farmacie').select('nome').eq('id',day.farmacia_id).maybeSingle(),
      day.consultant_id ? report.from('beauty_consultant').select('agent_id').eq('id',day.consultant_id).maybeSingle() : Promise.resolve({ data:null }),
    ]);
    if (client.error) throw client.error;
    if (consultant.error) throw consultant.error;
    const {error} = await primary.rpc('workspace_sync_beauty_day', {
      p_day:{...day,stato:deleted?'annullata':day.stato,customer_name:client.data?.nome,legacy_agent_id:consultant.data?.agent_id},
      p_actor_id:actorId,
    });
    if (error) throw error;
  }
}
