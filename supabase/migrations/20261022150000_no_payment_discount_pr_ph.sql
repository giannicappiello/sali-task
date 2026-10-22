begin;
set local lock_timeout='5s';
-- Never rewrite confirmed history. All PR/PH draft writes use commercial terms only.
create or replace function public.order_line_without_payment_discount()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_module text; v_state text; v_chain text; v_part text; v_net numeric; v_equivalent numeric;
begin
  select coalesce(modulo_ordini,'prof'),stato into v_module,v_state from public.ordini_testate where id=new.ordine_id;
  if v_state is distinct from 'bozza' or v_module not in ('prof','ph') or new.riga_spedizione then return new; end if;
  v_chain:=coalesce(new.dettaglio_calcolo->>'sconto_commerciale',new.sconto_commerciale,'');
  v_net:=coalesce(new.prezzo_listino,0);
  v_equivalent:=100;
  foreach v_part in array regexp_split_to_array(replace(v_chain,',','.'),'[+]') loop
    if btrim(v_part)<>'' then
      v_net:=v_net*(1-btrim(v_part)::numeric/100);
      v_equivalent:=v_equivalent*(1-btrim(v_part)::numeric/100);
    end if;
  end loop;
  new.sconto_commerciale:=v_chain; new.sconto_pagamento:=null; new.regola_pagamento_id:=null;
  new.sconto_percentuale:=round(100-v_equivalent,4);new.prezzo_netto:=v_net;
  new.imponibile_riga:=round(v_net*new.quantita,2);
  new.iva_riga:=case when new.iva_non_applicata then 0 else round(new.imponibile_riga*coalesce(new.aliquota_iva,0)/100,2) end;
  new.totale_riga:=new.imponibile_riga+new.iva_riga;
  new.dettaglio_calcolo:=coalesce(new.dettaglio_calcolo,'{}'::jsonb)||jsonb_build_object(
    'escludi_sconto_pagamento',true,'sconto_commerciale',v_chain,'sconto_pagamento','',
    'sconto_equivalente',new.sconto_percentuale,'prezzo_netto',v_net);
  return new;
end;$$;
revoke all on function public.order_line_without_payment_discount() from public,anon,authenticated;
create trigger ordini_righe_no_payment_discount before insert or update on public.ordini_righe
  for each row execute function public.order_line_without_payment_discount();

CREATE OR REPLACE FUNCTION public.conferma_ordine_workspace(p_ordine_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record;
begin
  perform 1 from public.ordini_testate where id=p_ordine_id and stato='bozza' for update;
  if not found then raise exception 'Ordine non trovato o già confermato'; end if;
  -- Keep caller visibility/ownership enforcement in the existing database RLS
  -- and customer boundary triggers when confirming a Private draft.
  -- Normalize legacy drafts too, before shipping threshold and totals.
  update public.ordini_righe set sconto_pagamento=sconto_pagamento
    where ordine_id=p_ordine_id and not riga_spedizione
      and exists(select 1 from public.ordini_testate o where o.id=p_ordine_id and coalesce(o.modulo_ordini,'prof') in ('prof','ph'));
  perform public.applica_spedizione_ordine(p_ordine_id);
  update public.ordini_testate set stato='aperto',confermato_at=now(),versione_conferma=versione_conferma+1,
    note_mexal=coalesce(note_mexal,'Workspace n. '||id::text),
    note=coalesce(note,'Workspace n. '||id::text),updated_at=now() where id=p_ordine_id;
  for r in select codice_articolo,sum(quantita) quantita from public.ordini_righe
    where ordine_id=p_ordine_id and not riga_descrittiva and not riga_spedizione group by codice_articolo
  loop
    update public.ordini_prodotti_cache set disponibilita=greatest(0,coalesce(disponibilita,0)-r.quantita),
      impegnato=coalesce(impegnato,0)+r.quantita,sincronizzato_il=now() where codice_articolo=r.codice_articolo;
  end loop;
end;
$function$;
notify pgrst,'reload schema';
commit;
