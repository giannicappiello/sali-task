# WorkspaceMES V3 — contratto formule FP

Nel flusso V3 un componente `FP*` della distinta Mexal è un riferimento esterno
alla formula autonoma di ProgreMES, non un articolo da sincronizzare nel database
MES.

Workspace invia per ogni fabbisogno formula:

- `fpCode`, normalizzato in maiuscolo;
- quantità richiesta;
- identificativo della riga Workspace;
- revisione OCT e revisione RdP.

Workspace non invia né deduce l'UDM dell'articolo FP. La cache articoli Mexal non
è quindi un prerequisito per un componente formula. La validazione Mexal di UDM,
stato articolo e forniture resta invece obbligatoria e fail-closed per i
componenti `DIRECT_COMPONENT`.

ProgreMES risolve `fpCode` esclusivamente contro il codice della propria tabella
`Formule`. Descrizione, UDM, versione attiva, componenti MP, Station, Filling e
batch sono dati autorevoli MES. La risposta MES restituisce l'UDM della formula.

I blocker contrattuali sono distinti:

- `FORMULA_MAPPING_MISSING`: codice formula MES inesistente;
- `FORMULA_VERSION_MISSING`: formula presente senza versione attiva;
- `FORMULA_UOM_MISSING`: formula presente senza UDM MES;
- `MATERIAL_MAPPING_MISSING`: componente MP della formula non risolto in MES.

Il vecchio campo `unitOfMeasure` della domanda formula resta accettato
temporaneamente da ProgreMES per consentire rollout indipendenti, ma viene
ignorato e non è più prodotto dal nuovo Workspace.
