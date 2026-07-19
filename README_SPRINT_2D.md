# Sprint 2D — Motore commerciale Mexal

## Funzioni incluse

- listino cliente;
- particolarità prezzo;
- particolarità sconto;
- matrice sconti cliente/articolo;
- sconto pagamento concatenato;
- dettaglio visibile del calcolo per ogni riga;
- priorità: prezzo speciale → particolarità sconto → matrice → pagamento;
- nessun calcolo o visualizzazione di margine e ricarico.

## File da sostituire

- `src/modules/orders/pages/NewOrder.jsx`
- `src/modules/orders/services/priceEngine.js`
- `src/modules/orders/orders-module.css`

## Query

Eseguire in Supabase SQL Editor:

`supabase/migrations/20260719090000_sprint_2d_commercial_engine.sql`

La query è ripetibile: ricrea le policy e crea gli indici solo se mancanti.

## Test

1. Arrestare Vite con `Ctrl + C`.
2. Avviare `npm run dev`.
3. Aggiornare il browser con `Ctrl + F5`.
4. Aprire Nuovo ordine.
5. Selezionare cliente e prodotto.
6. Premere il badge nella colonna **Condizione** per vedere listino, categorie, regola, pagamento e netto.
