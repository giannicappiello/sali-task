import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260725190000_mexal_queue_worker_rpcs.sql", import.meta.url),
  "utf8",
);
const worker = fs.readFileSync(
  new URL("../supabase/functions/mexal-sync-worker/index.ts", import.meta.url),
  "utf8",
);
const cron = fs.readFileSync(
  new URL("../supabase/cron/mexal-sync-worker.sql", import.meta.url),
  "utf8",
);
const config = fs.readFileSync(
  new URL("../supabase/config.toml", import.meta.url),
  "utf8",
);

assert.match(migration, /create or replace function public\.create_daily_mexal_sync_cycle/i);
assert.match(migration, /pg_advisory_xact_lock/i);
assert.match(migration, /for update/i);
assert.match(migration, /on conflict \(cycle_key\) do nothing/i);
assert.match(migration, /status in \('queued', 'leased', 'running', 'retry'\)/i);
assert.match(migration, /set search_path = pg_catalog, public, pg_temp/gi);

for (const name of [
  "heartbeat_mexal_sync_job",
  "complete_mexal_sync_job",
  "retry_mexal_sync_job",
  "fail_mexal_sync_job",
]) {
  assert.match(migration, new RegExp(`function public\\.${name}\\\\?\\(`, "i"));
}

assert.match(migration, /p_job_id bigint[\s\S]+p_worker_id text[\s\S]+p_lock_token uuid/i);
assert.match(migration, /grant execute[\s\S]+to service_role/i);
assert.doesNotMatch(migration, /grant execute[\s\S]+to authenticated/i);

assert.match(worker, /claim_next_mexal_sync_job/);
assert.match(worker, /p_worker_id:\s*workerId[\s\S]*p_lease_seconds:\s*JOB_LEASE_SECONDS/);
assert.match(worker, /const JOB_LEASE_SECONDS = 300/);
assert.match(worker, /WORKER_SECRET/);
assert.match(worker, /x-mexal-worker-secret/);
assert.doesNotMatch(worker, /authorizationMatch/);
assert.doesNotMatch(migration, /'Authorization',\s*'Bearer '/);
  assert.match(worker, /job_claimed/);
assert.match(worker, /run_scheduled_step/);
assert.match(worker, /heartbeat_mexal_sync_job/);
assert.match(worker, /complete_mexal_sync_job/);
assert.match(worker, /retry_mexal_sync_job/);
assert.match(worker, /MEXAL_AUTOMATION_URL/);
assert.doesNotMatch(worker, /sync-products|MEXAL_BASE_URL/i);

assert.match(migration, /cron\.schedule\(/);
assert.match(migration, /'\* \* \* \* \*'/);
assert.match(cron, /mexal-sync-worker-every-minute/);
assert.match(config, /\[functions\.mexal-sync-worker\][\s\S]*verify_jwt\s*=\s*false/);

console.log("mexal worker: infrastruttura dry-run verificata");
