// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite entry point.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const migration=await readFile('supabase/migrations/20261119164028_rdp_append_confirmed_commercial_lines.sql','utf8');
const amendments=await readFile('supabase/migrations/20261127102945_rdp_forecast_only_amendments.sql','utf8');
for(const [forecastsOnly,replacesForecast] of [[false,false],[true,false],[true,true]]) test(`confirmed amendments preserve links and replay without duplicates (forecastsOnly=${forecastsOnly},replacement=${replacesForecast})`,async()=>{
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;
    create table workspace_production_requests(id uuid primary key,contract_version int,workspace_status text,stato text,demand_snapshot_id bigint,updated_at timestamptz);
    create table workspace_v4_previews(id bigint primary key,production_request_id uuid,snapshot jsonb);
    create table ordini_righe(id uuid primary key,ordine_id uuid,codice_articolo text,quantita numeric,mexal_attiva boolean,riga_descrittiva boolean);
    create table workspace_production_request_items(id bigint generated always as identity,production_request_id uuid,ordine_id uuid,ordine_riga_id uuid,item_index int,item_external_key text,mexal_order_key text,mexal_line_position int,codice_articolo_commerciale text,mapping_status text,quantita_oct numeric,unita_misura_oct text,quantita_unita_produzione numeric,unita_misura_produzione text,conversione jsonb,data_consegna_richiesta date,mes_payload jsonb,unique(production_request_id,ordine_riga_id));
    create table workspace_production_demand_snapshots(id bigint generated always as identity,production_request_id uuid,snapshot_hash text,demand_hash text,contract_version int,order_count int,item_count int,snapshot jsonb,unique(production_request_id,snapshot_hash));
    create table workspace_v4_confirmation_mirrors(id bigint primary key,preview_id bigint,status text,mes_response jsonb);
    create function workspace_reconciled_oct_sources(uuid[]) returns table(order_id uuid) language sql as $$select null::uuid where false$$;`);
  await db.exec(migration);
  await db.exec(amendments);
  const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const item=(n,code,q)=>({lineId:id(n),orderId:id(164),itemIndex:n,itemExternalKey:`OC+2+164:${n}`,mexalOrderKey:'OC+2+164',mexalLinePosition:n,
    commercialArticleCode:code,requestedQuantity:q,requestedUnitOfMeasure:'PZ',productionQuantity:q,productionUnitOfMeasure:'PZ'});
  const demand={items:[item(2,'PB0009',25000),item(9,'PB0049',10000)],orders:[{orderId:id(164)}]};
  if(replacesForecast) {
    demand.retiredCommercialItems=[demand.items[0]];
    demand.items=demand.items.slice(1);
  }
  const response=forecastsOnly
    ? {productionCreated:false,productionOrders:[],forecastLines:[id(2),id(9)],preservedProductionLines:[]}
    : {productionCreated:true,productionOrders:[{id:6495,number:'RDP85'}],forecastLines:[id(9)],preservedProductionLines:[id(2)]};
  if(replacesForecast) { response.forecastLines=[id(9)];response.retiredCommercialLines=[id(2)]; }
  await db.query('insert into workspace_production_requests values($1,4,\'CONFIRMED\',\'CONFIRMED\',null,now())',[id(85)]);
  await db.query('insert into workspace_v4_previews values(1,$1,$2)',[id(85),{commercialDemand:demand}]);
  await db.query('insert into ordini_righe values($1,$2,\'PB0049\',10000,true,false)',[id(9),id(164)]);
  if(replacesForecast) await db.query('insert into ordini_righe values($1,$2,\'PB0009\',25000,false,false)',[id(2),id(164)]);
  await db.query(`insert into workspace_production_request_items(production_request_id,ordine_id,ordine_riga_id,item_index,codice_articolo_commerciale,quantita_oct,mes_payload)
    values($1,$2,$3,1,'PB0009',25000,'{"productionOrderId":6495}')`,[id(85),id(164),id(2)]);
  const before=(await db.query('select * from workspace_production_request_items')).rows[0];
  await db.query('insert into workspace_v4_confirmation_mirrors values(1,1,\'EXTENDED\',$1)',[response]);
  assert.deepEqual((await db.query('select * from workspace_production_request_items where item_index=1')).rows[0],before);
  assert.equal((await db.query('select count(*)::int n from workspace_production_request_items')).rows[0].n,2);
  assert.equal((await db.query('select snapshot from workspace_production_demand_snapshots')).rows[0].snapshot.items.at(-1).productionQuantity,10000);
  // Repeated receipt does not duplicate either the line or immutable snapshot.
  await db.query('insert into workspace_v4_confirmation_mirrors values(2,1,\'EXTENDED\',$1)',[response]);
  assert.equal((await db.query('select count(*)::int n from workspace_production_request_items')).rows[0].n,2);
  assert.equal((await db.query('select count(*)::int n from workspace_production_demand_snapshots')).rows[0].n,1);
  await assert.rejects(db.query('insert into workspace_v4_confirmation_mirrors values(4,1,\'EXTENDED\',$1)',
    [{...response,productionCreated:!response.productionCreated}]),/V5_APPEND_RECEIPT_INVALID/);
  const foreign=item(10,'FOREIGN',1);foreign.orderId=id(999);
  await db.query('insert into ordini_righe values($1,$2,\'FOREIGN\',1,true,false)',[id(10),id(999)]);
  await db.query('insert into workspace_v4_previews values(2,$1,$2)',[id(85),{commercialDemand:{...demand,items:[...demand.items,foreign]}}]);
  await assert.rejects(db.query('insert into workspace_v4_confirmation_mirrors values(3,2,\'EXTENDED\',$1)',[{...response,forecastLines:[...response.forecastLines,id(10)]}]),/V5_APPEND_FOREIGN_ORDER/);
  assert.equal((await db.query('select count(*)::int n from workspace_v4_confirmation_mirrors')).rows[0].n,2);
  await db.close();
});

