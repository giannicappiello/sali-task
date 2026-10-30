begin;
set local lock_timeout='5s';
create table public.ordini_regole_cartonaggi (
 id uuid primary key default gen_random_uuid(),
 modulo_ordini text not null check(modulo_ordini in('prof','ph')),
 tipo text not null check(tipo in('multiple_of','less_than','less_or_equal','greater_than','greater_or_equal','equal')),
 valore numeric(18,6) not null check(valore>0 and valore<=1000000000),
 prodotti text[] not null check(cardinality(prodotti)>0),
 attiva boolean not null default true,messaggio text not null default '' check(length(messaggio)<=500),
 creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now()
);
create index ordini_cartonaggi_module on public.ordini_regole_cartonaggi(modulo_ordini) where attiva;
create index ordini_cartonaggi_products on public.ordini_regole_cartonaggi using gin(prodotti);
alter table public.ordini_regole_cartonaggi enable row level security;
revoke all on public.ordini_regole_cartonaggi from public,anon;
grant select,insert,update,delete on public.ordini_regole_cartonaggi to authenticated;
grant all on public.ordini_regole_cartonaggi to service_role;
create policy carton_rules_read on public.ordini_regole_cartonaggi for select to authenticated
 using(public.workspace_current_profile_id() is not null);
-- Reuse the role-based administrative boundary of the order configuration.
do $$declare v_qual text;begin
 select qual into v_qual from pg_policies where schemaname='public' and tablename='ordini_moduli_configurazione' and policyname='admins manage order module config';
 if v_qual is null then raise exception 'Order configuration permission policy missing';end if;
 execute format('create policy carton_rules_manage on public.ordini_regole_cartonaggi for all to authenticated using(%s) with check(%s)',v_qual,v_qual);
end;$$;
create policy carton_rules_identity_boundary on public.ordini_regole_cartonaggi as restrictive for all to authenticated
 using(not public.club_external_identity()) with check(not public.club_external_identity());
create function public.normalize_order_carton_rule() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 new.prodotti:=array(select distinct upper(btrim(code)) from unnest(new.prodotti)code where nullif(btrim(code),'') is not null order by 1);
 if cardinality(new.prodotti)=0 then raise exception 'Seleziona almeno una referenza.';end if;
 new.messaggio:=btrim(new.messaggio);new.aggiornato_il:=now();return new;
end;$$;
create trigger normalize_order_carton_rule before insert or update on public.ordini_regole_cartonaggi
 for each row execute function public.normalize_order_carton_rule();

create function public.order_carton_quantity_allowed(p_quantity numeric,p_type text,p_value numeric)
returns boolean language sql immutable set search_path=pg_catalog,public as $$
 select coalesce(p_quantity>0 and case p_type
 when 'multiple_of' then mod(p_quantity,p_value)=0
 when 'less_than' then p_quantity<p_value
 when 'less_or_equal' then p_quantity<=p_value
 when 'greater_than' then p_quantity>p_value
 when 'greater_or_equal' then p_quantity>=p_value
 when 'equal' then p_quantity=p_value else false end,false);
$$;

create function public.assert_order_cartons(p_order uuid,p_module text default null) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_module text;v_state text;r record;v_label text;
begin
 select coalesce(p_module,modulo_ordini,'prof'),stato into v_module,v_state from public.ordini_testate where id=p_order;
 if v_state is distinct from 'bozza' or v_module not in('prof','ph') then return;end if;
 for r in
 select q.code,q.quantity,rule.* from (
 select upper(btrim(codice_articolo)) code,sum(quantita) quantity from public.ordini_righe
 where ordine_id=p_order and not coalesce(riga_spedizione,false) and not coalesce(riga_descrittiva,false)
 and nullif(btrim(codice_articolo),'') is not null group by upper(btrim(codice_articolo))
 )q join public.ordini_regole_cartonaggi rule on rule.modulo_ordini=v_module and rule.attiva and q.code=any(rule.prodotti)
 where not public.order_carton_quantity_allowed(q.quantity,rule.tipo,rule.valore)
 order by q.code,rule.creato_il,rule.id
 loop
 v_label:=case r.tipo when 'multiple_of' then 'Multipli di ' when 'less_than' then 'Quantità inferiore a '
 when 'less_or_equal' then 'Quantità non superiore a ' when 'greater_than' then 'Quantità superiore a '
 when 'greater_or_equal' then 'Quantità non inferiore a ' when 'equal' then 'Quantità pari a ' end;
 raise exception '%: %. Quantità inserita: %.',r.code,
 (case when r.messaggio<>'' then r.messaggio||' · ' else '' end)||v_label||r.valore,r.quantity using errcode='P0001';
 end loop;
end;$$;
create function public.enforce_order_carton_lines() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op<>'INSERT' then perform public.assert_order_cartons(old.ordine_id);end if;
 if tg_op<>'DELETE' and (tg_op='INSERT' or new.ordine_id is distinct from old.ordine_id) then perform public.assert_order_cartons(new.ordine_id);end if;
 return null;
end;$$;
-- Defer to the end of the atomic write: split/duplicate lines are checked by their
-- total quantity, while an entire draft can be replaced or cleared safely.
create constraint trigger ordini_cartonaggi_lines after insert or update or delete on public.ordini_righe
 deferrable initially deferred for each row execute function public.enforce_order_carton_lines();
create function public.enforce_order_carton_confirmation() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if old.stato='bozza' and (new.stato is distinct from old.stato or new.modulo_ordini is distinct from old.modulo_ordini) then
 perform public.assert_order_cartons(old.id,new.modulo_ordini);
 end if;
 return new;
end;$$;
create trigger ordini_cartonaggi_confirmation before update of stato,modulo_ordini on public.ordini_testate
 for each row execute function public.enforce_order_carton_confirmation();
revoke all on function public.assert_order_cartons(uuid,text),public.enforce_order_carton_lines(),public.enforce_order_carton_confirmation(),public.normalize_order_carton_rule() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
