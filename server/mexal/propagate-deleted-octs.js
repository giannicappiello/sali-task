import { createProgremesProductionClient } from '../progremes-production-client.js';

// Durable queue survives an old MES, transient errors and an uncertain reply.
// MES repeats physical deletion against retained source snapshots, never new targets.
export async function propagateDeletedOcts({ supabase, client = createProgremesProductionClient(), limit = 25, budgetMs = 60_000 }) {
  const { data: jobs, error } = await supabase.from('workspace_oct_deletions')
    .select('order_id,generation,payload').eq('status', 'PENDING').order('attempts').order('deleted_at').limit(limit);
  if (error) throw error;
  let completed = 0; const warnings = [];
  const deadline = Date.now() + budgetMs;
  for (const job of jobs || []) {
    if (Date.now() >= deadline) break;
    try {
      const { result } = await client.deleteOct(job.payload);
      if (result?.status === 'PARTIAL' && result.workspaceOctId === job.order_id)
        throw new Error((result.blockers || []).join('; ') || 'Lavorazioni avviate da stornare.');
      if (result?.status !== 'DELETED' || result.workspaceOctId !== job.order_id)
        throw new Error('Il MES non ha confermato l’eliminazione di questo OCT.');
      const { data, error: completeError } = await supabase.rpc('complete_deleted_oct', {
        p_order_id: job.order_id, p_generation: job.generation, p_response: result,
      });
      if (completeError) throw completeError;
      if (data === true) completed++;
    } catch (failure) {
      const message = String(failure.message || 'Eliminazione MES da riconciliare').slice(0, 500);
      const { error: saveError } = await supabase.rpc('record_deleted_oct_failure', {
        p_order_id: job.order_id, p_generation: job.generation, p_error: message,
      });
      if (saveError) throw saveError;
      warnings.push(`${job.payload.octReference}: eliminazione MES in attesa — ${message}`);
    }
  }
  return { mes_deleted_octs: completed, mes_deletion_pending: warnings.length, mes_deletion_warnings: warnings };
}
