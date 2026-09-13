# Recupero quantità formula nei consuntivi

La tabella degli scostamenti non trasforma più l'assenza di una quantità formula in zero. Le quantità negative/non numeriche/mancanti restano non disponibili, anche nel totale economico. Lo zero esplicitamente registrato resta valido.

## Fonti e priorità

1. Quantità e prezzi già presenti nel preventivo salvato restano prioritari.
2. MES esporta separatamente la ricostruzione storica anche quando il preventivo originale esiste ma è vuoto o incompleto.
3. Si usa la revisione identificata dal preventivo, oppure quella collegata alla produzione o univocamente ai prelievi. Non si sostituisce con la revisione attualmente attiva.
4. La quantità viene calcolata dalla quantità originaria del lotto, resa e percentuale del componente, con gli arrotondamenti del foglio produzione. Per i prodotti finiti si richiede una quantità bulk in kg: i pezzi non diventano kg.
5. Workspace integra i codici mancanti e i gruppi con quantità incomplete. Non aggiunge un intero fabbisogno formula ai lotti parziali dello stesso componente. I codici vengono confrontati senza differenze di maiuscole e spazi esterni.
6. Le righe interamente mancanti sono valorizzate con i costi ultimi disponibili e segnalate come ricostruzione, non come prezzi storici originali. Nei gruppi originali con quantità incomplete il prezzo viene mantenuto solo se univoco, altrimenti resta sconosciuto.

Lo SL non viene mai copiato nel preventivo. Non vengono riscritti snapshot originali, SL, giacenze, lotti, planning, regole di manodopera o permessi. Nessuna migrazione SQL necessaria.

## Dopo il rilascio

Aggiornare MES da main (fetch, pull e procedura aggiorna), poi aprire CONSUNTIVI PRODUZIONI e usare **Importa / aggiorna storico MES**. Il refresh aggiorna l'evidenza importata e ricalcola i confronti anche delle lavorazioni concluse, conservando gli originali.

Le produzioni senza una revisione formula storica identificabile o una quantità bulk affidabile rimangono esplicitamente incomplete: la correzione non inventa il dato. La modifica Workspace da sola corregge i falsi zeri; il nuovo recupero richiede anche MES aggiornato e reimportazione.
