import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

export function digitalSchedulerToken(serviceKey) {
  return crypto.createHmac('sha256', serviceKey).update('crm-digital-daily').digest('hex');
}

export function authorizedDigitalScheduler(req, serviceKey, cronSecret) {
  const token = String(req?.headers?.authorization || '').replace(/^Bearer /, '');
  const expected = [serviceKey && digitalSchedulerToken(serviceKey), cronSecret].filter(Boolean);
  return expected.some(value => token.length === value.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(value)));
}

// A database lease and persisted provider cursor survive process death, retries
// and provider rate limits. Each HTTP call handles a bounded slice of one job.
export async function runDigitalDailyJobs({ db, synchronize, connectionById, now = () => Date.now(), budgetMs = 150000 }) {
  const { data: job, error } = await db.rpc('crm_claim_digital_daily_job_service');
  if (error) throw error;
  if (!job) return { processed: 0, results: [] };
  const deadline = now() + budgetMs; let pages = 0, result, keepRunning, coverageTarget;
  try {
    do {
      const connection = await connectionById(db, job.connection_id);
      if (!connection.abilitata || !connection.sync_attivo) {
        result = { status: 'cancelled', recordsRead: 0 }; break;
      }
      result = await synchronize(db, null, connection, 'scheduled');
      let coverageThrough, catchUpRequired = false;
      if (connection.provider_code === 'amazon_sp_api' && !result.hasMore) {
        // A resumed historical cursor may finish long before this job's time window.
        // Use the persisted run creation time so retries never chase a moving target.
        if (!coverageTarget) {
          const run = await db.from('crm_sync_runs').select('created_at').eq('id',job.run_id).single();
          if (run.error) throw run.error;
          const created = Date.parse(run.data?.created_at);
          if (!Number.isFinite(created)) throw new Error('Orario della sincronizzazione programmata non disponibile.');
          coverageTarget = new Date(created - 180000).toISOString();
        }
        const fresh = await connectionById(db,job.connection_id);
        coverageThrough = fresh.import_state?.to;
        if (!fresh.import_state?.completed || !Number.isFinite(Date.parse(coverageThrough))) throw new Error('Copertura temporale Amazon non confermata.');
        catchUpRequired = Date.parse(coverageThrough) < Date.parse(coverageTarget);
        if (catchUpRequired) result = { ...result, hasMore:true, status:'partial' };
      }
      const nextStatus = result.hasMore ? 'queued' : 'completed';
      keepRunning = result.hasMore && !result.retryAfterMs && now() < deadline;
      const saved = await db.rpc('crm_progress_digital_daily_job_service', {
        p_job_id: job.id, p_token: job.lease_token, p_status: nextStatus,
        p_read: result.recordsRead || 0, p_delay_seconds: Math.ceil((result.retryAfterMs || 0) / 1000), p_error: null,
        p_details: { resource: result.resource, counts: result.counts, source: 'scheduled', timezone: 'Europe/Rome', local_time: '23:00', ...(coverageThrough ? {coverage_through:coverageThrough,coverage_target:coverageTarget,catch_up_required:catchUpRequired} : {}) },
        p_release: !keepRunning,
      });
      if (saved.error) throw saved.error;
      pages++;
    } while (keepRunning);
    if (result.status === 'cancelled') {
      const saved = await db.rpc('crm_progress_digital_daily_job_service', { p_job_id: job.id, p_token: job.lease_token, p_status: 'cancelled', p_read: 0, p_delay_seconds: 0, p_error: null, p_details: {}, p_release: true });
      if (saved.error) throw saved.error;
    }
    return { processed: 1, results: [{ connectionId: job.connection_id, runId: job.run_id, pages, status: result.status, hasMore: result.hasMore || false }] };
  } catch (failure) {
    const saved = await db.rpc('crm_progress_digital_daily_job_service', { p_job_id: job.id, p_token: job.lease_token, p_status: 'failed', p_read: 0,
      p_delay_seconds: failure.code === '55P03' ? 60 : 300, p_error: String(failure.message || 'Sincronizzazione non riuscita').slice(0, 500), p_details: { source: 'scheduled', cursor_preserved: true }, p_release: true });
    if (saved.error) throw saved.error;
    return { processed: 1, results: [{ connectionId: job.connection_id, runId: job.run_id, pages, status: saved.data?.status || 'failed' }] };
  }
}
