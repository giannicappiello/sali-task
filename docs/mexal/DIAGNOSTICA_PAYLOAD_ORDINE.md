# Diagnostica payload ordine Mexal

La diagnostica viene eseguita esclusivamente in locale e non crea alcuna Serverless Function Vercel.

## Prerequisiti

Impostare nel terminale le stesse variabili ambiente usate dall'integrazione Mexal e da Supabase:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- tutte le variabili Mexal richieste da `buildMexalClient()`

## Comando

Dalla cartella del progetto eseguire:

```powershell
npm run mexal:diagnose-order -- <orderId> <OCM|OCX|OCI> <sigla> <serie> <numero>
```

Esempio:

```powershell
npm run mexal:diagnose-order -- 00000000-0000-0000-0000-000000000000 OCM OC 1 12345
```

Lo script:

1. legge da Supabase la testata e le righe dell'ordine;
2. costruisce localmente il payload POST dell'app;
3. esegue solo il GET Mexal `/documenti/ordini-clienti/{sigla}+{serie}+{numero}`;
4. confronta campi, tipi, formati e nomenclature;
5. salva il risultato in `diagnostics/mexal/<tipo>-<sigla>-<serie>-<numero>.json`.

Non viene eseguito alcun POST verso Mexal e non viene modificato alcun dato.
