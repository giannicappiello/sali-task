-- CRM BRAND DIRECT segue lo stesso perimetro autorizzativo dei canali DIRECT.
-- La modifica interessa esclusivamente il catalogo accessi e non i dati operativi.

begin;

update public.workspace_moduli
set assegnabile_reparto=false,
    dipendenze_alternative=array['crm_b2b','crm_online'],
    aggiornato_il=now()
where codice='crm_brand_direct';

commit;
