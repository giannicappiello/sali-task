begin;
set local lock_timeout='5s';
-- Order history is permanent. Older deployed clients cannot re-enable expiry.
update public.mexal_ordini_manutenzione set pulizia_automatica=false,aggiornato_il=now() where id=1;
alter table public.mexal_ordini_manutenzione add constraint mexal_orders_permanent_history check (pulizia_automatica=false);

create table public.workspace_order_mexal_references (
 ordine_id uuid not null references public.ordini_testate(id) on delete cascade,
 codice_cliente text not null,sigla text not null,serie integer not null,numero text not null,anno integer not null,
 source text not null,created_at timestamptz not null default now(),
 primary key(ordine_id,codice_cliente,sigla,serie,numero,anno)
);
create index workspace_order_mexal_reference_identity on public.workspace_order_mexal_references(codice_cliente,sigla,serie,numero,anno);
create table public.workspace_order_invoice_associations (
 fattura_id uuid not null references public.mexal_fatture_vendita(id) on delete cascade,
 posizione_riferimento text not null,ordine_id uuid not null references public.ordini_testate(id) on delete cascade,
 sigla_ordine text not null,serie_ordine integer not null,numero_ordine text not null,anno_ordine integer not null,
 source text not null,created_at timestamptz not null default now(),
 primary key(fattura_id,posizione_riferimento)
);
create index workspace_order_invoice_associations_order on public.workspace_order_invoice_associations(ordine_id,fattura_id);
alter table public.workspace_order_mexal_references enable row level security;
alter table public.workspace_order_invoice_associations enable row level security;
create policy references_visible_parent on public.workspace_order_mexal_references for select to authenticated
 using(exists(select 1 from public.ordini_testate o where o.id=ordine_id));
create policy associations_visible_parent_and_invoice on public.workspace_order_invoice_associations for select to authenticated
 using(exists(select 1 from public.ordini_testate o where o.id=ordine_id)
 and exists(select 1 from public.mexal_fatture_vendita f where f.id=fattura_id));
revoke all on public.workspace_order_mexal_references,public.workspace_order_invoice_associations from public,anon,authenticated;
grant select on public.workspace_order_mexal_references,public.workspace_order_invoice_associations to authenticated;
grant all on public.workspace_order_mexal_references,public.workspace_order_invoice_associations to service_role;

-- Parse the actual Mexal identity, including series. Invalid/incomplete references cannot match.
create function public.workspace_invoice_order_references(p_data jsonb)
returns table(pos text,sigla text,serie integer,numero text,anno integer,order_date text)
language sql immutable set search_path=pg_catalog,public as $$
 with matrices as (
 select n->>0 pos,upper(btrim(s->>1)) sigla,se->>1 serie,n->>1 numero,replace(dt->>1,'-','') order_date
 from jsonb_array_elements(case when jsonb_typeof(p_data->'numero_ordine')='array' then p_data->'numero_ordine' else '[]'::jsonb end)n
 join jsonb_array_elements(case when jsonb_typeof(p_data->'sigla_ordine')='array' then p_data->'sigla_ordine' else '[]'::jsonb end)s on s->>0=n->>0
 join jsonb_array_elements(case when jsonb_typeof(p_data->'serie_ordine')='array' then p_data->'serie_ordine' else '[]'::jsonb end)se on se->>0=n->>0
 join jsonb_array_elements(case when jsonb_typeof(p_data->'data_ordine')='array' then p_data->'data_ordine' else '[]'::jsonb end)dt on dt->>0=n->>0
 ) select distinct pos,sigla,case when serie~'^[0-9]{1,8}$' then serie::integer end,
 coalesce(nullif(ltrim(numero,'0'),''),'0'),case when order_date~'^[0-9]{8}$' then left(order_date,4)::integer end,order_date
 from matrices where numero~'^[0-9]+$' and serie~'^[0-9]{1,8}$' and order_date~'^[0-9]{8}$' and sigla<>'';
$$;

create function public.capture_workspace_order_references(p_order uuid) returns void
language sql security definer set search_path=pg_catalog,public as $$
 insert into public.workspace_order_mexal_references(ordine_id,codice_cliente,sigla,serie,numero,anno,source)
 select o.id,o.codice_cliente,upper(coalesce(nullif(d.sigla,''),'OC')),d.serie,
 coalesce(nullif(ltrim(btrim(d.numero),'0'),''),'0'),coalesce(d.anno,extract(year from o.data_ordine)::integer),'document'
 from public.ordini_testate o join public.ordini_documenti_mexal d on d.ordine_id=o.id
 where o.id=p_order and o.modulo_ordini<>'ph' and btrim(d.numero)~'^[0-9]+$' and d.serie is not null
 union
 select o.id,o.codice_cliente,upper(o.mexal_sigla),o.mexal_serie,
 coalesce(nullif(ltrim(btrim(o.mexal_numero::text),'0'),''),'0'),o.mexal_anno,'imported_header'
 from public.ordini_testate o where o.id=p_order and o.modulo_ordini<>'ph' and o.mexal_sigla is not null
 and o.mexal_serie is not null and o.mexal_anno is not null and btrim(o.mexal_numero::text)~'^[0-9]+$'
 on conflict(ordine_id,codice_cliente,sigla,serie,numero,anno) do update set source=excluded.source
 where workspace_order_mexal_references.source='legacy_header_invoice';
$$;

-- Indexed parsed references avoid scanning/reparsing every invoice on each sync.
create table public.workspace_invoice_reference_index (
 fattura_id uuid not null references public.mexal_fatture_vendita(id) on delete cascade,
 codice_cliente text not null,pos text not null,sigla text not null,serie integer not null,numero text not null,anno integer not null,order_date text not null,
 primary key(fattura_id,pos,sigla,serie,numero,anno)
);
create index workspace_invoice_reference_identity on public.workspace_invoice_reference_index(codice_cliente,sigla,numero,anno,serie);
alter table public.workspace_invoice_reference_index enable row level security;
revoke all on public.workspace_invoice_reference_index from public,anon,authenticated;
grant all on public.workspace_invoice_reference_index to service_role;
insert into public.workspace_invoice_reference_index
 select f.id,f.codice_cliente,r.* from public.mexal_fatture_vendita f cross join lateral public.workspace_invoice_order_references(f.dati_mexal)r where f.sigla='FT';

create function public.reconcile_workspace_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 delete from public.workspace_invoice_reference_index where fattura_id=p_invoice;
 insert into public.workspace_invoice_reference_index
 select f.id,f.codice_cliente,r.* from public.mexal_fatture_vendita f cross join lateral public.workspace_invoice_order_references(f.dati_mexal)r where f.id=p_invoice and f.sigla='FT';
 -- Legacy orders whose child documents were purged: exact customer/date/number,
 -- and one possible series in the entire invoice archive. Never guess between orders.
 with legacy as (
 select distinct o.id ordine_id,f.codice_cliente,r.*
 from public.mexal_fatture_vendita f cross join lateral public.workspace_invoice_order_references(f.dati_mexal)r
 join public.ordini_testate o on o.codice_cliente=f.codice_cliente and o.modulo_ordini<>'ph' and o.stato<>'bozza'
 and to_char(o.data_ordine,'YYYYMMDD')=r.order_date and r.sigla='OC'
 and exists(select 1 from unnest(array[o.numero_ocm,o.numero_ocx,o.numero_oci,o.numero_oct])n
  where btrim(n)~'^[0-9]+$' and coalesce(nullif(ltrim(btrim(n),'0'),''),'0')=r.numero)
 where f.id=p_invoice and f.sigla='FT'
 and not exists(select 1 from public.workspace_order_mexal_references known where known.ordine_id=o.id and known.numero=r.numero and known.anno=r.anno)
 and 1=(select count(distinct r2.serie) from public.workspace_invoice_reference_index r2
 where r2.codice_cliente=f.codice_cliente and r2.sigla=r.sigla and r2.numero=r.numero and r2.anno=r.anno)
 ), candidates as (
 select l.*,count(*) over(partition by codice_cliente,sigla,serie,numero,anno) n from legacy l
 ) insert into public.workspace_order_mexal_references(ordine_id,codice_cliente,sigla,serie,numero,anno,source)
 select ordine_id,codice_cliente,sigla,serie,numero,anno,'legacy_header_invoice' from candidates c where n=1
 and not exists(select 1 from public.workspace_order_mexal_references known where known.codice_cliente=c.codice_cliente and known.sigla=c.sigla and known.serie=c.serie and known.numero=c.numero and known.anno=c.anno and known.ordine_id<>c.ordine_id)
 on conflict do nothing;

 -- Refresh only this invoice, atomically. No stale link survives a corrected Mexal reference.
 delete from public.workspace_order_invoice_associations where fattura_id=p_invoice;
 with candidates as (
 select distinct f.id fattura_id,r.pos,a.ordine_id,r.sigla,r.serie,r.numero,r.anno,a.source
 from public.mexal_fatture_vendita f cross join lateral public.workspace_invoice_order_references(f.dati_mexal)r
 join public.workspace_order_mexal_references a on a.codice_cliente=f.codice_cliente
 and a.sigla=r.sigla and a.serie=r.serie and a.numero=r.numero and a.anno=r.anno
 join public.ordini_testate o on o.id=a.ordine_id and o.modulo_ordini<>'ph'
 where f.id=p_invoice and f.sigla='FT'
 and (a.source<>'legacy_header_invoice' or 1=(select count(distinct x.serie) from public.workspace_invoice_reference_index x
 where x.codice_cliente=a.codice_cliente and x.sigla=a.sigla and x.numero=a.numero and x.anno=a.anno))
 ), potential_orders as (
 select fattura_id,pos,ordine_id from candidates
 union
 select f.id,r.pos,o.id
 from public.mexal_fatture_vendita f cross join lateral public.workspace_invoice_order_references(f.dati_mexal)r
 join public.ordini_testate o on o.codice_cliente=f.codice_cliente and o.modulo_ordini<>'ph' and o.stato<>'bozza'
 and to_char(o.data_ordine,'YYYYMMDD')=r.order_date and r.sigla='OC'
 and exists(select 1 from unnest(array[o.numero_ocm,o.numero_ocx,o.numero_oci,o.numero_oct])n
  where btrim(n)~'^[0-9]+$' and coalesce(nullif(ltrim(btrim(n),'0'),''),'0')=r.numero)
 where f.id=p_invoice and f.sigla='FT'
 and not exists(select 1 from public.workspace_order_mexal_references known where known.ordine_id=o.id and known.numero=r.numero and known.anno=r.anno)
 ), unique_refs as (
 select fattura_id,pos from potential_orders group by fattura_id,pos having count(distinct ordine_id)=1
 ) insert into public.workspace_order_invoice_associations(fattura_id,posizione_riferimento,ordine_id,sigla_ordine,serie_ordine,numero_ordine,anno_ordine,source)
 select distinct on(c.fattura_id,c.pos) c.fattura_id,c.pos,c.ordine_id,c.sigla,c.serie,c.numero,c.anno,c.source
 from candidates c join unique_refs u using(fattura_id,pos) order by c.fattura_id,c.pos,c.source;
end;$$;

-- Trigger-based reconciliation works for automatic and manual synchronization alike,
-- regardless of which arrives first (invoice or order).
create function public.workspace_invoice_association_trigger() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare f record;
begin
 perform public.reconcile_workspace_invoice(new.id);
 -- A second series or corrected reference can make a previous legacy match ambiguous.
 for f in select distinct x.fattura_id from public.workspace_invoice_reference_index x
 join public.workspace_invoice_order_references(coalesce(new.dati_mexal,'{}'::jsonb)) r
 on x.sigla=r.sigla and x.numero=r.numero and x.anno=r.anno
 where x.codice_cliente=new.codice_cliente and x.fattura_id<>new.id loop
  perform public.reconcile_workspace_invoice(f.fattura_id);
 end loop;
 return new;
end;$$;
create function public.workspace_order_reference_trigger() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_order uuid;v_customer text;f record;
begin
 if tg_table_name='ordini_documenti_mexal' then v_order:=new.ordine_id;else v_order:=new.id;end if;
 perform public.capture_workspace_order_references(v_order);
 select codice_cliente into v_customer from public.ordini_testate where id=v_order;
 for f in select id from public.mexal_fatture_vendita where codice_cliente=v_customer and sigla='FT' loop
  perform public.reconcile_workspace_invoice(f.id);
 end loop;
 return new;
end;$$;

-- Seed all known identities, then reconcile EVERY existing invoice.
do $$declare o record;f record;begin
 for o in select id from public.ordini_testate where modulo_ordini<>'ph' loop perform public.capture_workspace_order_references(o.id);end loop;
 for f in select id from public.mexal_fatture_vendita where sigla='FT' loop perform public.reconcile_workspace_invoice(f.id);end loop;
end;$$;
create trigger workspace_invoice_associations after insert or update of dati_mexal,codice_cliente,sigla on public.mexal_fatture_vendita
 for each row execute function public.workspace_invoice_association_trigger();
create trigger workspace_order_references after insert or update of numero,serie,sigla,anno,ordine_id on public.ordini_documenti_mexal
 for each row execute function public.workspace_order_reference_trigger();
create trigger workspace_header_references after insert or update of numero_ocm,numero_ocx,numero_oci,numero_oct,mexal_numero,mexal_serie,mexal_anno,mexal_sigla,codice_cliente,data_ordine,stato on public.ordini_testate
 for each row execute function public.workspace_order_reference_trigger();

create or replace function public.workspace_order_invoice_links(p_order_ids uuid[])
returns table(ordine_id uuid,invoice jsonb,expected_lines jsonb)
language sql stable security invoker set search_path=pg_catalog,public as $$
 with linked as (
 select distinct a.ordine_id,f.id,f.sigla,f.serie,f.numero,f.data_documento,f.dati_mexal
 from public.workspace_order_invoice_associations a join public.ordini_testate o on o.id=a.ordine_id
 join public.mexal_fatture_vendita f on f.id=a.fattura_id
 where a.ordine_id=any(p_order_ids) and o.modulo_ordini<>'ph'
 ) select l.ordine_id,jsonb_build_object('id',l.id,'sigla',l.sigla,'serie',l.serie,'numero',l.numero,'data_documento',l.data_documento,
 'single_order',(select count(distinct (r.sigla,r.serie,r.numero,r.anno))=1 and count(distinct r.pos)=jsonb_array_length(l.dati_mexal->'numero_ordine') from public.workspace_invoice_order_references(l.dati_mexal)r),
 'articles',l.dati_mexal->'codice_articolo','quantities',l.dati_mexal->'quantita','units',l.dati_mexal->'tp_um_articolo',
 'order_references',jsonb_build_object('numbers',l.dati_mexal->'numero_ordine','dates',l.dati_mexal->'data_ordine','types',l.dati_mexal->'sigla_ordine','series',l.dati_mexal->'serie_ordine')),
 (select coalesce(jsonb_agg(jsonb_build_object('code',r.codice_articolo,'quantity',r.quantita,'unit',r.tipo_unita_misura_mexal)),'[]'::jsonb)
 from public.ordini_righe r where r.ordine_id=l.ordine_id and not coalesce(r.riga_descrittiva,false) and r.codice_articolo is not null)
 from linked l;
$$;
revoke all on function public.capture_workspace_order_references(uuid),public.reconcile_workspace_invoice(uuid),public.workspace_invoice_association_trigger(),public.workspace_order_reference_trigger() from public,anon,authenticated;
grant execute on function public.capture_workspace_order_references(uuid),public.reconcile_workspace_invoice(uuid) to service_role;
notify pgrst,'reload schema';
commit;
