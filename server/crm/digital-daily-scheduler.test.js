/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { authorizedDigitalScheduler, digitalSchedulerToken, runDigitalDailyJobs } from './digital-daily-scheduler.js';

test('scheduler accepts only its derived credential or existing cron credential', () => {
  const req = value => ({ headers: { authorization: `Bearer ${value}` } });
  assert.equal(authorizedDigitalScheduler(req(digitalSchedulerToken('test-service-key')), 'test-service-key'), true);
  assert.equal(authorizedDigitalScheduler(req('test-service-key'), 'test-service-key'), false);
  assert.equal(authorizedDigitalScheduler(req(''), undefined, undefined), false);
  assert.equal(authorizedDigitalScheduler(req('wrong'), 'test-service-key'), false);
});

test('rate-limited provider releases the job with a persisted retry, without sleeping', async () => {
  const calls = [];
  const db = { rpc: async (name, params) => { calls.push({ name, params }); return { data: name.includes('claim') ? { id: 'job', lease_token: 'token', connection_id: 'connection', run_id: 'run' } : {}, error: null }; } };
  const result = await runDigitalDailyJobs({ db, connectionById: async () => ({ abilitata: true, sync_attivo: true }), synchronize: async () => ({ hasMore: true, status: 'partial', retryAfterMs: 180000, recordsRead: 0 }) });
  assert.equal(result.results[0].pages, 1);
  assert.equal(calls[1].params.p_release, true); assert.equal(calls[1].params.p_delay_seconds, 180);
});

test('worker aggregates bounded pages and records provider failures on the scheduled run', async () => {
  const calls = []; let count = 0;
  const db = { rpc: async (name, params) => { calls.push({ name, params }); return { data: name.includes('claim') ? { id: 'job', lease_token: 'token', connection_id: 'connection', run_id: 'run' } : { status: 'queued' }, error: null }; } };
  await runDigitalDailyJobs({ db, connectionById: async () => ({ abilitata: true, sync_attivo: true }), synchronize: async () => ({ hasMore: ++count < 2, status: 'completed', recordsRead: 5 }) });
  assert.equal(calls.length, 3); assert.equal(calls[1].params.p_release, false); assert.equal(calls[2].params.p_release, true);
  await runDigitalDailyJobs({ db, connectionById: async () => ({ abilitata: true, sync_attivo: true }), synchronize: async () => { throw new Error('Provider unavailable'); } });
  assert.equal(calls.at(-1).params.p_error, 'Provider unavailable');
  assert.equal(calls.at(-1).params.p_status, 'failed');
});

test('SQL schedule handles Rome DST, idempotency, leases, retry and history', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE); const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role;
      create schema auth; create schema extensions; create schema vault; create schema net; create schema cron;
      create function auth.role() returns text language sql as $$select 'service_role'$$;
      create function extensions.hmac(text,text,text) returns bytea language sql as $$select convert_to('fake-token','UTF8')$$;
      create table vault.decrypted_secrets(name text,decrypted_secret text);
      insert into vault.decrypted_secrets values('SUPABASE_SERVICE_ROLE_KEY','not-a-real-secret');
      create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
      create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
      create table crm_external_connections(id uuid primary key default gen_random_uuid(),abilitata boolean,sync_attivo boolean,sync_frequency text,prossima_run_il timestamptz,ultimo_errore text);
      create table crm_sync_runs(id uuid primary key default gen_random_uuid(),connection_id uuid,sync_type text,mode text,status text,idempotency_key text,details jsonb default '{}',started_at timestamptz,heartbeat_at timestamptz,completed_at timestamptz,
        records_read integer default 0,records_updated integer default 0,records_failed integer default 0,duration_ms bigint,error_message text,error_code text,created_at timestamptz default now());
      insert into crm_external_connections(abilitata,sync_attivo,sync_frequency) values(true,false,'manual'),(false,false,'manual');`);
    await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261020200000_crm_digital_daily_2300.sql', import.meta.url), 'utf8'));
    for (const [input, expected] of [['2026-10-24T20:00:00Z','2026-10-24T21:00:00.000Z'],['2026-10-24T21:00:00Z','2026-10-25T22:00:00.000Z'],['2026-03-28T22:00:00Z','2026-03-29T21:00:00.000Z']]) {
      const value = (await db.query('select crm_digital_next_daily($1) value',[input])).rows[0].value;
      assert.equal(new Date(value).toISOString(),expected);
    }
    assert.equal((await db.query("select crm_tick_digital_daily('2026-10-20T20:59:00Z') n")).rows[0].n,0);
    assert.equal((await db.query("select crm_tick_digital_daily('2026-10-20T21:00:00Z') n")).rows[0].n,1);
    assert.equal((await db.query("select crm_tick_digital_daily('2026-10-20T21:01:00Z') n")).rows[0].n,0);
    const job=(await db.query('select crm_claim_digital_daily_job_service() j')).rows[0].j;
    assert.ok(job.lease_token);
    assert.equal((await db.query('select crm_claim_digital_daily_job_service() j')).rows[0].j,null);
    await assert.rejects(db.query("select crm_progress_digital_daily_job_service($1,gen_random_uuid(),'completed',1,0,null,'{}',true)",[job.id]));
    await db.query("select crm_progress_digital_daily_job_service($1,$2,'queued',5,0,null,'{}',false)",[job.id,job.lease_token]);
    await db.query("select crm_progress_digital_daily_job_service($1,$2,'completed',2,0,null,'{}',true)",[job.id,job.lease_token]);
    const run=(await db.query('select * from crm_sync_runs')).rows[0];
    assert.equal(run.status,'completed');assert.equal(run.records_read,7);assert.equal(run.details.local_time,'23:00');
    // Disabled connections are never activated or queued by the migration.
    assert.equal((await db.query('select count(*)::int n from crm_digital_daily_jobs')).rows[0].n,1);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select crm_claim_digital_daily_job_service()'));
    await db.exec('reset role');
  } finally { await db.close(); }
});


test('Amazon finishes an old cursor then catches up to the scheduled window before completing', async () => {
  const calls=[]; let step=0;
  const connection={abilitata:true,sync_attivo:true,provider_code:'amazon_sp_api',import_state:{completed:false,to:'2026-10-20T09:00:00Z'}};
  const db={rpc:async(name,params)=>{calls.push({name,params});return {data:name.includes('claim')?{id:'job',lease_token:'token',connection_id:'connection',run_id:'run'}:{},error:null};},
    from:()=>({select:()=>({eq:()=>({single:async()=>({data:{created_at:'2026-10-20T21:00:00Z'},error:null})})})})};
  const result=await runDigitalDailyJobs({db,connectionById:async()=>connection,synchronize:async()=>{
    step++; connection.import_state={completed:true,to:step===1?'2026-10-20T09:00:00Z':'2026-10-20T21:27:00Z'};
    return {status:'completed',hasMore:false,recordsRead:step===1?100:27};
  }});
  const progress=calls.filter(c=>c.name.includes('progress'));
  assert.equal(step,2); assert.equal(result.results[0].hasMore,false);
  assert.equal(progress[0].params.p_status,'queued'); assert.equal(progress[0].params.p_details.catch_up_required,true);
  assert.equal(progress[1].params.p_status,'completed'); assert.equal(progress[1].params.p_details.coverage_target,'2026-10-20T20:57:00.000Z');
  assert.equal(progress[1].params.p_details.coverage_through,'2026-10-20T21:27:00Z');
});

test('Amazon catch-up survives HTTP budget exhaustion and uses the original job time on retry', async () => {
  const calls=[];
  const connection={abilitata:true,sync_attivo:true,provider_code:'amazon_sp_api',import_state:{completed:true,to:'2026-10-20T09:00:00Z'}};
  const db={rpc:async(name,params)=>{calls.push({name,params});return {data:name.includes('claim')?{id:'job',lease_token:'token',connection_id:'connection',run_id:'run'}:{},error:null};},
    from:()=>({select:()=>({eq:()=>({single:async()=>({data:{created_at:'2026-10-20T21:00:00Z'},error:null})})})})};
  const first=await runDigitalDailyJobs({db,budgetMs:0,now:()=>Date.parse('2026-10-20T21:30:00Z'),connectionById:async()=>connection,synchronize:async()=>({status:'completed',hasMore:false})});
  assert.equal(first.results[0].hasMore,true); assert.equal(calls.at(-1).params.p_status,'queued'); assert.equal(calls.at(-1).params.p_release,true);
  connection.import_state.to='2026-10-20T21:27:00Z';
  const retry=await runDigitalDailyJobs({db,now:()=>Date.parse('2026-10-21T02:00:00Z'),connectionById:async()=>connection,synchronize:async()=>({status:'completed',hasMore:false})});
  assert.equal(retry.results[0].hasMore,false); assert.equal(calls.at(-1).params.p_status,'completed');
});
