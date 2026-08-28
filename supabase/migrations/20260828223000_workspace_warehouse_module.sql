begin;

alter table if exists public.prodotti
  add column if not exists costo_ultimo numeric(14,6) not null default 0 check (costo_ultimo >= 0);

alter table if exists public.ordini_prodotti_cache
  add column if not exists costo_ultimo numeric(14,6) not null default 0 check (costo_ultimo >= 0);

update public.prodotti
set costo_ultimo = greatest(0, replace(coalesce(nullif(btrim(json_mexal->>'costo_ult'),''),nullif(btrim(json_mexal->>'cos_ult'),''),'0'),',','.')::numeric)
where coalesce(nullif(btrim(json_mexal->>'costo_ult'),''),nullif(btrim(json_mexal->>'cos_ult'),''),'') ~ '^[+-]?[0-9]+([.,][0-9]+)?$';

update public.ordini_prodotti_cache
set costo_ultimo = greatest(0, replace(coalesce(nullif(btrim(dati_mexal->>'costo_ult'),''),nullif(btrim(dati_mexal->>'cos_ult'),''),'0'),',','.')::numeric)
where coalesce(nullif(btrim(dati_mexal->>'costo_ult'),''),nullif(btrim(dati_mexal->>'cos_ult'),''),'') ~ '^[+-]?[0-9]+([.,][0-9]+)?$';

comment on column public.prodotti.costo_ultimo is 'Costo ultimo Mexal: campo reale costo_ult, alias cos_ult; mai derivato dal prezzo di vendita.';
comment on column public.ordini_prodotti_cache.costo_ultimo is 'Costo ultimo Mexal salvato nel database Workspace per valorizzare le giacenze.';

insert into public.workspace_moduli (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,assegnabile_reparto,livello_self_service,dipendenze,protetto,configurabile_ruolo,mostra_menu,attivo,ordine,icona,aggiornato_il)
values ('magazzino','Magazzino','Giacenze, disponibilità e valorizzazione economica Workspace.','modulo','anagrafiche','/magazzino','workspace',true,false,'lettura','{}',false,true,true,true,65,'warehouse',now())
on conflict (codice) do update set nome=excluded.nome,descrizione=excluded.descrizione,percorso=excluded.percorso,provider=excluded.provider,sempre_disponibile=true,livello_self_service='lettura',mostra_menu=true,attivo=true,ordine=excluded.ordine,icona=excluded.icona,aggiornato_il=now();

insert into public.workspace_schermate (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,icona,metadati,ultima_sincronizzazione)
values ('magazzino','Magazzino','Giacenze, disponibilità e valorizzazione economica Workspace.','workspace','/magazzino','warehouse',false,true,65,'anagrafiche','warehouse','{}'::jsonb,now())
on conflict (codice) do update set nome=excluded.nome,descrizione=excluded.descrizione,provider=excluded.provider,percorso=excluded.percorso,chiave_componente=excluded.chiave_componente,attiva=true,ordine=excluded.ordine,area=excluded.area,icona=excluded.icona,ultima_sincronizzazione=now();

insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values ('magazzino','magazzino',10,true,true)
on conflict (modulo_codice,schermata_codice) do update set ordine=10,predefinita=true,visibile_menu=true;

insert into public.workspace_menu_voci(codice,nome,descrizione,icona,ordine,attiva,aggiornata_il)
values ('magazzino','Magazzino','Giacenze, disponibilità e valorizzazione economica Workspace.','warehouse',65,true,now())
on conflict (codice) do update set nome=excluded.nome,descrizione=excluded.descrizione,icona=excluded.icona,ordine=excluded.ordine,attiva=true,aggiornata_il=now();

insert into public.workspace_menu_moduli(voce_codice,modulo_codice,ordine)
values ('magazzino','magazzino',10)
on conflict (voce_codice,modulo_codice) do update set ordine=10;

insert into public.ruoli_moduli(ruolo_id,modulo,livello_accesso,aggiornato_il)
select ruolo_id,'magazzino',livello_accesso,now() from public.ruoli_moduli where modulo='prodotti'
on conflict (ruolo_id,modulo) do nothing;

commit;
