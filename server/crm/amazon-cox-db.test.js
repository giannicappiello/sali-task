/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('COX journal: duplicate connections, service permissions, retryable preflight, irreversible claims and cutoff', { skip: !process.env.PGLITE_MODULE }, async () => {
  const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
      create function auth.role() returns text language sql as $$select coalesce(current_setting('test.auth_role',true),'service_role')$$;
      create table crm_external_connections(id uuid primary key default gen_random_uuid(),provider_code text,abilitata boolean default true);
      create table crm_external_orders(id uuid primary key default gen_random_uuid(),connection_id uuid references crm_external_connections(id),external_id text,stato text,ordered_at timestamptz);
      insert into crm_external_connections(provider_code) values('amazon_sp_api'),('amazon_sp_api'),('woocommerce');`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261021150000_amazon_cox_exports.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261022113000_amazon_cox_verified_reconciliation.sql',import.meta.url),'utf8'));
    const conns=(await db.query('select * from crm_external_connections order by provider_code')).rows;
    const add=async(conn,external,date='2026-10-21T08:00:00Z',status='SHIPPED')=>(await db.query('insert into crm_external_orders(connection_id,external_id,stato,ordered_at) values($1,$2,$3,$4) returning id',[conn.id,external,status,date])).rows[0].id;
    const claim=async id=>(await db.query('select crm_claim_amazon_cox_service($1) token',[id])).rows[0].token;
    const finish=(id,token,status,ref=null)=>db.query('select crm_finish_amazon_cox_service($1,$2,$3,$4,null)',[id,token,status,ref]);
    const first=await add(conns[0],'123-1234567-1234567'),duplicate=await add(conns[1],'123-1234567-1234567');
    const token=await claim(first);assert.ok(token);assert.equal(await claim(first),null);assert.equal(await claim(duplicate),null);
    await finish(first,token,'blocked');const retry=await claim(first);assert.ok(retry);assert.notEqual(retry,token);
    await assert.rejects(finish(first,token,'blocked'),/Claim COX/);
    await finish(first,retry,'reconciliation_required');assert.equal(await claim(duplicate),null);
    assert.equal((await db.query('select cox_status from crm_external_orders where id=$1',[duplicate])).rows[0].cox_status,'reconciliation_required');
    await assert.rejects(finish(first,retry,'blocked'),/Claim COX/);
    await finish(first,retry,'emitted',{year:'2026',series:1,number:123,date:'20261021'});
    assert.equal(await claim(first),null);
    const second=await add(conns[0],'222-1234567-1234567'),t2=await claim(second);
    await assert.rejects(finish(second,t2,'emitted'),/Riferimento/);
    await finish(second,t2,'emitted',{year:'2026',series:1,number:987,date:'20261021'});
    assert.equal(await claim(second),null);
    assert.equal((await db.query('select cox_reference from crm_external_orders where id=$1',[second])).rows[0].cox_reference.number,987);
    await assert.rejects(claim(await add(conns[0],'old','2026-10-20T21:59:59Z')),/Ordine Amazon/);
    assert.ok(await claim(await add(conns[0],'midnight','2026-10-20T22:00:00Z')));
    await assert.rejects(claim(await add(conns[0],'partial','2026-10-21T10:00:00Z','PARTIALLY_SHIPPED')),/Ordine Amazon/);
    await assert.rejects(claim(await add(conns[2],'website')),/Ordine Amazon/);
    await db.exec("set test.auth_role='authenticated'");
    await assert.rejects(claim(second),/Servizio riservato/);
    await assert.rejects(db.query("update crm_external_orders set cox_status='blocked' where id=$1",[first]),/riservato/);
    await assert.rejects(db.query("insert into crm_external_orders(cox_status) values('emitted')"),/riservato/);
    assert.equal((await db.query('select count(*)::int n from crm_amazon_cox_exports')).rows[0].n,3);
  }finally{await db.close();}
});
