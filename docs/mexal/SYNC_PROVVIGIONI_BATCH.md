# Sincronizzazione provvigioni listini a batch

La sincronizzazione manuale delle provvigioni listini viene eseguita tramite richieste HTTP brevi e riprendibili.

## Flusso

1. L'avvio crea una run in `mexal_sync_runs`.
2. Il payload Mexal viene salvato temporaneamente in `mexal_sync_payload_rows`.
3. Ogni richiesta elabora un solo batch e aggiorna i contatori della run.
4. Il frontend avvia automaticamente il batch successivo.
5. Se la pagina viene riaperta mentre la run è ancora attiva, l'elaborazione riprende dal valore `processed`.
6. L'arresto imposta la run a `cancelled` e rimuove il payload temporaneo.
7. Al completamento il payload temporaneo viene eliminato.

## Migrazione richiesta

Applicare `supabase/migrations/20260722190000_mexal_sync_payload_rows.sql` prima del test.
