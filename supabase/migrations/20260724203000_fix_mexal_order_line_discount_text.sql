-- Gli sconti Mexal possono essere formule concatenate (es. 50+35+0).
-- Conservarli come testo evita conversioni numeriche non valide e mantiene il dato originale.
alter table if exists public.ordini_documenti_mexal_righe
  alter column sconto type text
  using sconto::text;
