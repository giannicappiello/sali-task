# Fase 1C.0 — OCT → RdP → OP → OdP

## Confini e nomenclatura

- **OCT**: ordine cliente importato in sola lettura da Mexal.
- **RdP** (`WorkspaceProductionRequest`): richiesta commerciale generata da Workspace per una riga OCT.
- **OP** (`WorkspaceProductionProposal`): proposta di produzione tecnica generata dal MES; non è pianificabile e non possiede lotto.
- **OdP**: `OrdineProduzione` MES esistente, creato soltanto quando Workspace conferma una OP.
- **Lotto**: creato dal MES soltanto dopo OP → OdP; l'OdP Workspace entra nel planner solo dopo l'assegnazione.

```text
Mexal OCT → ordini_testate/ordini_righe → RdP Workspace → MES
  → mapping/Formula/capacità (solo MES) → OP 1..N → fabbisogni
  → OP a Workspace → conferma → OdP MES → coda lotto → planner
```

Workspace non riceve formula, versione, componenti, FP tecnici, distinta, impianto, ciclo o lotto. I codici FP restano consentiti nei flussi operativi; l'esclusione FP riguarda soltanto l'anagrafica `/articles` della Fase 1B.

## Import OCT

L'importer inbound è separato da `ORDER_DOCUMENTS`, che continua a descrivere esclusivamente OCM/OCX/OCI outbound. Riusa `ordini_testate` e `ordini_righe`, imposta `origine=mexal_oct` e usa `sigla+serie+numero` come identità Mexal. Cliente, PB/FP e righe descrittive vengono conservati anche quando non risolti localmente; solo le righe con codice e quantità positiva possono generare una RdP.

L'identificazione `OC + cod_modulo=T` resta **NON VERIFICATA** nel payload reale. Per questo l'import è OFF e richiede sia `MEXAL_OCT_MODULE_CODE` sia `MEXAL_OCT_LIST_PATH`; M/X/I sono sempre esclusi. Un trigger DB e un controllo applicativo impediscono a `origine=mexal_oct` di passare nel flusso `submit-order`.

## Affidabilità e sicurezza

- `external_id` RdP è un UUID stabile e univoco per riga OCT.
- La conferma OP prenota atomicamente un UUID stabile prima della chiamata MES; i retry riusano lo stesso UUID.
- MES e Workspace firmano le POST con HMAC-SHA256 su metodo, path, timestamp, event/idempotency ID e hash del body.
- Si riusano soltanto `PROGREMES_URL` e `PROGREMES_INTEGRATION_SECRET`, entrambi server-side; redirect HTTP disabilitati.
- L'inbox Workspace persiste `event_id`, hash e sequenza in una RPC transazionale: duplicati identici sono no-op, ID con hash diverso sono conflitto, eventi vecchi non regrediscono lo stato.
- Le tabelle interne hanno RLS e nessun accesso `anon`/`authenticated`; gli handler usano service role dopo auth Workspace o HMAC MES.

## Feature flag (tutti OFF)

- `MEXAL_OCT_IMPORT_ENABLED`
- `PROGREMES_PRODUCTION_REQUESTS_ENABLED`
- `PROGREMES_PRODUCTION_CALLBACKS_ENABLED`
- `PROGREMES_PRODUCTION_CONFIRMATIONS_ENABLED`

Il merge non abilita scritture in Production. `MEXAL_OCT_MODULE_CODE` e `MEXAL_OCT_LIST_PATH` vanno valorizzati solo dopo verifica del contratto reale.

## Migrazioni e rollback

Le migrazioni aggiungono campi OCT alle tabelle esistenti, RdP, mirror OP, inbox, RPC evento e prenotazione conferma. Non sono state applicate a Production. Il rollback richiede prima di disabilitare tutti i flag, drenare outbox/inbox e poi rimuovere funzioni, trigger, tabelle e colonne in ordine inverso; non cancellare dati OCT senza esportazione approvata.

## Collaudo successivo

1. Applicare le migrazioni solo in ambiente isolato e lasciare i flag OFF.
2. Verificare schema/RLS e che un ordine `mexal_oct` sia respinto da `submit-order`.
3. Configurare e validare in sola lettura il contratto OCT reale; confermare `cod_modulo` prima di abilitare l'import.
4. Abilitare soltanto import OCT, verificando idempotenza di `OC+2+412`, cliente `501.00159`, PB0004 e righe descrittive.
5. Abilitare in sequenza RdP MES, callback e conferma; verificare RdP 7000 → OP 4000+3000, nessun lotto.
6. Confermare una sola OP: deve nascere un solo OdP e un solo lotto; retry e restart non duplicano.
7. Verificare che l'altra OP continui a concorrere ai fabbisogni e che l'OdP senza lotto non compaia nel planner.

## Non verificato

- `cod_modulo=T` come discriminante OCT reale.
- Path/paginazione della lista OCT Mexal: intenzionalmente configurabili.
- Applicazione delle migrazioni su un clone dei dati Production e collaudo end-to-end reale.
