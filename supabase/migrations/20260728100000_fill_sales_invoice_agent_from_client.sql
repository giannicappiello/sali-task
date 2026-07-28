begin;

update public.mexal_fatture_vendita f
set codice_agente_mexal = c.codice_agente_mexal,
    agente_nome = coalesce(
      nullif(btrim(concat_ws(' ', a.nome, a.cognome)), ''),
      c.codice_agente_mexal
    ),
    aggiornato_il = now()
from public.ordini_clienti_cache c
left join public.mexal_agenti a on a.codice = c.codice_agente_mexal
where c.codice_cliente = f.codice_cliente
  and nullif(btrim(coalesce(f.codice_agente_mexal, '')), '') is null
  and nullif(btrim(coalesce(c.codice_agente_mexal, '')), '') is not null;

commit;
