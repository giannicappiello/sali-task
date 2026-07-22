-- La sincronizzazione normalizza codice e sconto direttamente dal payload Mexal.
-- Rimuove il trigger della precedente correzione: non poteva creare modalità
-- assenti e poteva scegliere uno sconto arbitrario da payload annidati.
drop trigger if exists trg_normalize_mexal_payment_discount
  on public.ordini_regole_pagamento;
drop function if exists public.normalize_mexal_payment_discount();
drop function if exists public.mexal_first_payment_discount(jsonb);
