begin;
-- Workspace deletion is inherited from the Direzione role, with no personal
-- exception and no authorization to cancel the original Mexal documents.
insert into public.permessi(codice,descrizione,modulo)
values('orders.delete','Elimina definitivamente qualsiasi ordine in Workspace, inclusi ordini già inviati a Mexal','orders')
on conflict(codice) do update set descrizione=excluded.descrizione,modulo=excluded.modulo;
insert into public.permessi_ruolo(ruolo_id,permesso_id)
select r.id,p.id from public.ruoli r cross join public.permessi p
where lower(btrim(r.nome))='direzione' and p.codice='orders.delete'
on conflict(ruolo_id,permesso_id) do nothing;
notify pgrst,'reload schema';
commit;
