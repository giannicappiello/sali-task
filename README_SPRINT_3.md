# Sprint 3 - Ordini Mexal OCM/OCX

Funzioni introdotte:

- invio dell'ordine confermato a Mexal tramite API Vercel;
- separazione automatica delle quantità disponibili in OCM e mancanti in OCX;
- memorizzazione dei numeri documento restituiti da Mexal;
- stato di sincronizzazione e messaggio di errore;
- storico tecnico di ogni tentativo OCM/OCX;
- pagina dettaglio ordine con retry;
- PDF ordine scaricabile dal browser;
- aggiornamento giacenze dopo un invio riuscito.

## Variabili Vercel richieste

Già utilizzate dalle sincronizzazioni esistenti:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MEXAL_BASE_URL`
- `MEXAL_USERNAME`
- `MEXAL_PASSWORD`
- `MEXAL_AZIENDA`
- `MEXAL_ANNO`
- `MEXAL_MAGAZZINO`

Nuove, con valori predefiniti:

- `MEXAL_ORDER_ENDPOINT=/documenti/ordini-clienti`
- `MEXAL_OCM_SERIE=M`
- `MEXAL_OCX_SERIE=X`

Le serie possono essere cambiate da Vercel senza modificare il codice.
