# Diagnostica payload ordine Mexal

L'endpoint amministrativo `POST /api/mexal/orders/diagnose-document` legge un ordine esistente da Mexal senza inviare alcun `POST` a Mexal. Richiede `orderId`, `kind` (OCM, OCX o OCI), `sigla`, `serie` e `numero`.

La chiamata esegue precisamente il GET `/documenti/ordini-clienti/{sigla}+{serie}+{numero}`, conserva **integralmente** la risposta in `mexal_order_payload_diagnostics.get_payload`, costruisce senza inviarlo il payload POST dell'app e lo conserva in `post_payload`.

`comparison` elenca `missing_fields`, `additional_fields`, `type_differences`, `format_differences` e `nomenclature_differences`. Il JSON GET salvato è il riferimento da usare prima di qualsiasi futura modifica al formato di `data_documento`.
