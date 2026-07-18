# Sprint 2B — Salvataggio condizioni commerciali Mexal

Questo pacchetto abilita la sincronizzazione reale tramite Vercel e il salvataggio in Supabase di:

- matrice sconti cliente/articolo;
- particolarità commerciali;
- regole sconto pagamento, quando l'endpoint è configurato;
- storico esecuzioni, dettagli ed errori.

## File da sostituire

Copia le cartelle `api` e `src` nella radice del progetto mantenendo i percorsi.

## Migrazione SQL

Esegui nel SQL Editor Supabase:

`supabase/migrations/20260718195500_sprint_2b_commercial_sync_hardening.sql`

La migrazione è idempotente e aggiunge indici e una vista riepilogativa.

## Deploy

```powershell
git add .
git commit -m "Sprint 2B salvataggio condizioni commerciali Mexal"
git push origin main
```

Attendi il redeploy Vercel.

## Prima sincronizzazione reale

1. Apri **Centro Integrazioni → Mexal ERP**.
2. Lascia **Dry Run disattivato**.
3. Seleziona modalità **Completa**.
4. Lascia **Regole pagamento** attivo.
5. Premi **Sincronizza** e conferma.

Se `MEXAL_PAYMENT_DISCOUNT_ENDPOINT` non è configurato, la sincronizzazione completa matrice e particolarità e lascia invariate le regole pagamento manuali.

## Verifica

Esegui `docs/VALIDAZIONE_SPRINT_2B.sql` nel SQL Editor Supabase.
