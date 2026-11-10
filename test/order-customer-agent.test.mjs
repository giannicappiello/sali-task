import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import process from 'node:process';
const migration=await readFile(new URL('../supabase/migrations/20261110105827_order_agent_from_customer.sql',import.meta.url),'utf8');
test('all order writers use the customer agent, retain authorization and preserve sent history',async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE);const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table ordini_clienti_cache(codice_cliente text primary key,codice_agente_mexal text);
 create table ordini_testate(id uuid primary key,codice_cliente text,codice_agente_mexal text,agente_nome text,modulo_ordini text,creato_da text,stato text default 'bozza',note text);
 create table crm_audit_log(utente_id uuid,entita_tipo text,entita_id uuid,operazione text,dettagli jsonb);
 create function workspace_current_profile_id()returns uuid language sql as $$select null::uuid$$;
 create function resolve_mexal_agent_name(code text)returns text language sql as $$select case code when 'A' then 'Agente A' when 'B' then 'Agente B' when 'Z' then 'Fuori squadra' end$$;
 insert into ordini_clienti_cache values('C1','A'),('C2',' B '),('C3',null),('C4','Z');
 insert into ordini_testate(id,codice_cliente,modulo_ordini,codice_agente_mexal,agente_nome,stato)values
 ('00000000-0000-0000-0000-000000000001','C1','ph',null,null,'aperto'),
 ('00000000-0000-0000-0000-000000000002','C1','ph','HISTORICAL','Nome storico','evaso');
 create function sent_immutable()returns trigger language plpgsql as $$begin if old.stato='evaso' and (new.codice_agente_mexal is distinct from old.codice_agente_mexal or new.codice_cliente is distinct from old.codice_cliente or new.agente_nome is distinct from old.agente_nome) then raise exception 'sent order immutable';end if;return new;end$$;
 create trigger ordini_testate_prevent_sent_client_edit before update on ordini_testate for each row execute function sent_immutable();
 `);
 await db.exec(migration);
 let rows=(await db.query('select * from ordini_testate order by id')).rows;
 assert.equal(rows[0].codice_agente_mexal,'A');assert.equal(rows[0].agente_nome,'Agente A');
 assert.equal(rows[1].codice_agente_mexal,'HISTORICAL');assert.equal(rows[1].agente_nome,'Nome storico');
 assert.equal((await db.query('select count(*)::int n from crm_audit_log')).rows[0].n,1);
 for(const [index,module] of ['ph','prof','private'].entries()){
 const id=`00000000-0000-0000-0000-00000000000${index+3}`;
 await db.query('insert into ordini_testate(id,codice_cliente,codice_agente_mexal,agente_nome,modulo_ordini,creato_da)values($1,$2,$3,$4,$5,$6)',[id,'C2','UPLOADER','Nome inventato',module,'BACKOFFICE']);
 const order=(await db.query('select * from ordini_testate where id=$1',[id])).rows[0];
 assert.equal(order.codice_agente_mexal,'B');assert.equal(order.agente_nome,'Agente B');
 }
 await db.exec(`update ordini_testate set codice_cliente='C1' where id='00000000-0000-0000-0000-000000000003'`);
 assert.equal((await db.query("select codice_agente_mexal,agente_nome from ordini_testate where id='00000000-0000-0000-0000-000000000003'")).rows[0].agente_nome,'Agente A');
 await db.exec(`update ordini_testate set codice_agente_mexal='OTHER',agente_nome='OTHER' where id='00000000-0000-0000-0000-000000000003'`);
 assert.equal((await db.query("select codice_agente_mexal from ordini_testate where id='00000000-0000-0000-0000-000000000003'")).rows[0].codice_agente_mexal,'A');
 for(const customer of ['C3','UNKNOWN',null]){
 await db.query(`update ordini_testate set codice_cliente=$1 where id='00000000-0000-0000-0000-000000000003'`,[customer]);
 const order=(await db.query("select codice_agente_mexal,agente_nome from ordini_testate where id='00000000-0000-0000-0000-000000000003'")).rows[0];
 assert.equal(order.codice_agente_mexal,null);assert.equal(order.agente_nome,null);
 }
 // Background updates must not rewrite historical ownership or violate sent locks.
 await db.exec(`update ordini_clienti_cache set codice_agente_mexal='B' where codice_cliente='C1';update ordini_testate set note='sync result' where id='00000000-0000-0000-0000-000000000002'`);
 assert.equal((await db.query("select codice_agente_mexal from ordini_testate where id='00000000-0000-0000-0000-000000000002'")).rows[0].codice_agente_mexal,'HISTORICAL');
 await assert.rejects(db.exec(`update ordini_testate set codice_cliente='C2' where id='00000000-0000-0000-0000-000000000002'`),/sent order immutable/);
 // The trigger's privileged lookup never grants permission to write another team's orders.
 await db.exec(`alter table ordini_testate enable row level security;create policy own_team on ordini_testate for all to authenticated using(codice_agente_mexal in('A','B'))with check(codice_agente_mexal in('A','B'));grant select,insert,update on ordini_testate to authenticated;set role authenticated;`);
 await assert.rejects(db.exec(`insert into ordini_testate(id,codice_cliente,codice_agente_mexal)values('00000000-0000-0000-0000-000000000006','C4','A')`),/row-level security/);
 await db.exec(`insert into ordini_testate(id,codice_cliente,codice_agente_mexal)values('00000000-0000-0000-0000-000000000007','C2','A')`);
 assert.equal((await db.query("select codice_agente_mexal from ordini_testate where id='00000000-0000-0000-0000-000000000007'")).rows[0].codice_agente_mexal,'B');
 }finally{await db.close();}
});
