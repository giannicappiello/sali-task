# Sprint 2C — Motore prezzi Mexal

Questo pacchetto collega la creazione dell'ordine alle condizioni commerciali già sincronizzate in Supabase.

## Funzioni incluse

- prezzo di listino del cliente, con fallback al listino 1;
- matrice categoria sconto cliente × categoria sconto articolo;
- particolarità prezzo e sconto;
- sconto pagamento applicato dopo lo sconto commerciale;
- sconti concatenati calcolati in sequenza;
- scelta della regola più specifica;
- esclusione automatica delle regole inattive o fuori validità;
- memorizzazione della provenienza e dello snapshot del calcolo su ogni riga ordine.

## Caso di validazione noto

Cliente 501.02487, categoria sconto 2, articolo IT0001, categoria articolo 9:

- prezzo: 4,60;
- sconto commerciale: 50+35;
- Bonifico Anticipato: aggiunta del 5%;
- netto atteso con pagamento: 1,42025, visualizzato a 1,42 euro.
