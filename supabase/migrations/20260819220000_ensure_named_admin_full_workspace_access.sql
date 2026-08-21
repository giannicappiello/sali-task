begin;

-- Riallinea esclusivamente il ruolo storico denominato "Admin". Per tutti gli
-- altri ruoli resta necessario il flag esplicito configurabile dall'interfaccia.
update public.ruoli
set
  amministratore_workspace = true,
  ambito_dati = 'tutti',
  livello_accesso = 'amministrazione'
where lower(btrim(coalesce(nome, ''))) = 'admin';

commit;
