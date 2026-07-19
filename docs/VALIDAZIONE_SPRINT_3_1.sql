select count(*) as serie_sincronizzate from public.ordini_serie_documenti where attiva = true;
select sigla_documento, serie, descrizione, attiva from public.ordini_serie_documenti order by sigla_documento, serie;
select * from public.ordini_configurazione_documenti where id = 1;
