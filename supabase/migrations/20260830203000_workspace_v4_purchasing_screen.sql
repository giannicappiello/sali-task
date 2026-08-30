begin;

update public.workspace_schermate
set provider='workspace',
    percorso='/produzione/fabbisogni-acquisto',
    chiave_componente='workspacemes-v4-purchasing',
    protetta=true,
    attiva=true,
    area='produzione',
    icona='shopping-cart',
    descrizione='Calcolo mensile Workspace V4 di materie prime e packaging, con giacenze e arrivi certificati MES e creazione controllata dei PF Mexal.',
    metadati=coalesce(metadati,'{}'::jsonb)||jsonb_build_object(
      'workspace_local',true,
      'contract_version',4,
      'calculation_owner','WORKSPACE',
      'mes_source','purchase-requirements-source'),
    ultima_sincronizzazione=now()
where codice='progremes.Ordini.Fabbisogni';

commit;
