import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createMesDdtPrinting} from '../server/ddt-mes-print.js';
import {previewDdtPrintSettings,warehousePrintOptions,readDdtPrintSettings,applyDdtPrintSettings} from '../server/ai/ddt-print-settings.js';
import {availableControlledActions} from '../server/ai/controlled-actions.js';

test('preview is read only, permission checked and binds the actual warehouse printer and version',async()=>{
  let writes=0;
  const auth={profile:{id:'admin',ruoli:{amministratore_workspace:true}},admin:{
    rpc:async(name)=>{assert.equal(name,'workspace_screen_permission_for_user');return {data:true};},
    from:()=>({select(){return this;},eq(){return this;},single:async()=>({data:{updated_at:'2026-11-03T08:00:00Z',print_options:{},ddt_printer_id:'MES:Old',packing_printer_id:'MES:Old'}})}),
  }};
  const printing={readInventory:async()=>({enabled:true,warehousePrintOptionsVersion:1,configuration:{warehousePrinter:'Ricoh Magazzino'},printers:[{name:'Ricoh Magazzino',available:true,canPrintSilently:true}]})};
  const proposal=await previewDdtPrintSettings(auth,{reason:'Regole richieste'}, {printing});
  assert.equal(proposal.printerId,'MES:Ricoh Magazzino');
  assert.equal(proposal.expectedUpdatedAt,'2026-11-03T08:00:00Z');
  assert.deepEqual(proposal.printOptions,warehousePrintOptions);
  assert.equal(writes,0);
  await assert.rejects(readDdtPrintSettings({...auth,profile:{ruoli:{}}},{printing}),/non autorizzata/);
  await assert.rejects(previewDdtPrintSettings(auth,{reason:'Test'}, {printing:{readInventory:async()=>({enabled:true})}}),/Aggiornare ProgreMES/);
  assert.equal(availableControlledActions({profile:{ruoli:{}},capabilities:{role_ai_level:'conferma',progremes:true}}).DDT_PRINT_SETTINGS_UPDATE,undefined);
});

test('bridge sends original DDT, three copies and fixed profile; each pallet is a distinct request',async()=>{
  const bytes=Buffer.from('%PDF-test');const sha256=createHash('sha256').update(bytes).digest('hex');
  let job;const sent=[];
  const db={rpc:async(name,args)=>args.p_action==='claim'?{data:{acquired:true,job}}:{data:args.p_data},
    from:()=>({select(){return this;},eq(key,value){if(key==='kind')this.kind=value;return this;},
      single:async function(){assert.equal(this.kind,job.document_kind==='bcf_print'?'bcf':job.document_kind);return {data:{filename:'doc.pdf',base64:bytes.toString('base64'),sha256}};}})};
  const bridge=createMesDdtPrinting({env:{PROGREMES_URL:'https://mes.example.test',PROGREMES_INTEGRATION_SECRET:'test'},transport:async(url,opts)=>{
    sent.push(url);assert.equal(opts.body,bytes.equals(opts.body)?opts.body:null);
    for(const [key,val] of Object.entries(warehousePrintOptions))assert.equal(url.searchParams.get(key),val);
    return {ok:true,json:async()=>({id:'remote',requestId:'ddt:'+job.id,printer:'Ricoh Magazzino',status:'Queued'})};
  }});
  job={id:'ddt',preparation_id:'order',document_kind:'bcf_print',printer_id:'MES:Ricoh Magazzino',print_options:warehousePrintOptions};
  await bridge.sync(db,job.id);assert.equal(sent[0].searchParams.get('copies'),'3');
  for(const id of ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']){
    job={...job,id,document_kind:'packing_pallet_'+id,copies:2};await bridge.sync(db,id);
  }
  assert.equal(new Set(sent.map(u=>u.searchParams.get('requestId'))).size,3);
  assert.equal(sent[1].searchParams.get('copies'),'2');
});

test('lost settings response reads the persisted success without applying a second time',async()=>{
  let calls=0;
  const saved={id:'p',status:'executed'};
  const auth={profile:{id:'u'},admin:{rpc:async()=>{calls++;throw Error('Timeout');},
    from:()=>({select(){return this;},eq(){return this;},single:async()=>({data:saved})})}};
  assert.equal((await applyDdtPrintSettings(auth,{id:'p'})).action,saved);assert.equal(calls,1);
});

test('SQL requires human confirmation, checks current permissions and version, snapshots future jobs only',async()=>{
  assert.ok(process.env.PGLITE_MODULE,'PGLITE_MODULE is required for the database verification');
  const {PGlite}=await import(process.env.PGLITE_MODULE);const db=new PGlite();
  const user='11111111-1111-4111-8111-111111111111',proposal='22222222-2222-4222-8222-222222222222';
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
      create function auth.role() returns text language sql as $$select current_setting('test.role')$$;
      set test.role='service_role';set test.permission='true';
      create table ruoli(id int primary key,amministratore_workspace boolean);insert into ruoli values(1,true);
      create table utenti(id uuid primary key,ruolo_id int,attivo boolean);insert into utenti values('${user}',1,true);
      create function workspace_screen_permission_for_user(uuid,text,text) returns boolean language sql as $$select current_setting('test.permission')::boolean$$;
      create table warehouse_preparation_settings(id boolean primary key,updated_at timestamptz,ddt_printer_id text,packing_printer_id text);
      insert into warehouse_preparation_settings values(true,'2026-11-03Z','MES:Ricoh','MES:Ricoh');
      create table warehouse_print_jobs(id int primary key,printer_id text,document_kind text,status text);
      insert into warehouse_print_jobs values(1,'MES:Ricoh','bcf_print','uncertain');
      create table warehouse_printers(id text primary key,station text);insert into warehouse_printers values('MES:Ricoh','MES');
      create table warehouse_dispatch_configuration_events(actor uuid,before_settings jsonb,after_settings jsonb);
      create table ai_action_registry(code text primary key,system text,risk_level text,input_schema jsonb,required_permission text,active boolean,updated_at timestamptz);
      create table ai_action_audit(id uuid primary key,user_id uuid,tool text,system text,payload_summary jsonb,status text,confirmed_at timestamptz,executed_at timestamptz,before_snapshot jsonb,result jsonb);`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261103090000_ddt_print_options_review.sql',import.meta.url),'utf8'));
    const payload={reason:'Richiesta utente',printerId:'MES:Ricoh',expectedUpdatedAt:'2026-11-03T00:00:00Z',printOptions:warehousePrintOptions};
    await db.query("insert into ai_action_audit(id,user_id,tool,system,payload_summary,status) values($1,$2,'DDT_PRINT_SETTINGS_UPDATE','mes',$3,'proposed')",[proposal,user,payload]);
    const apply=()=>db.query('select warehouse_apply_print_settings_proposal($1,$2)',[proposal,user]);
    await assert.rejects(apply(),/HUMAN_CONFIRMATION_REQUIRED/);
    await db.exec(`update ai_action_audit set status='confirmed',confirmed_at=now();set test.permission='false'`);
    await assert.rejects(apply(),/FORBIDDEN/);
    await db.exec(`set test.permission='true';update warehouse_preparation_settings set updated_at='2026-11-04Z'`);
    await assert.rejects(apply(),/Configurazione cambiata/);
    assert.deepEqual((await db.query('select print_options from warehouse_preparation_settings')).rows[0].print_options,{});
    await db.exec(`update warehouse_preparation_settings set updated_at='2026-11-03Z'`);await apply();await apply();
    assert.equal((await db.query('select count(*)::int n from warehouse_dispatch_configuration_events')).rows[0].n,1);
    assert.deepEqual((await db.query('select print_options from warehouse_print_jobs where id=1')).rows[0].print_options,{});
    await db.exec("insert into warehouse_print_jobs(id,printer_id,document_kind) values(2,'MES:Ricoh','bcf_print')");
    assert.deepEqual((await db.query('select print_options from warehouse_print_jobs where id=2')).rows[0].print_options,warehousePrintOptions);
    await assert.rejects(db.exec("update warehouse_print_jobs set print_options='{}' where id=2"),/immutabile/);
    await assert.rejects(db.exec("insert into warehouse_print_jobs(id,printer_id,document_kind) values(3,'MES:Ricoh','packing_list')"),/singolo|bancale/);
    await db.exec("insert into warehouse_print_jobs(id,printer_id,document_kind) values(3,'MES:Ricoh','packing_pallet_11111111-1111-4111-8111-111111111111')");
  }finally{await db.close();}
});
