# Diagnostica provvigioni Mexal

Questa diagnostica serve **solo** a rilevare il contratto reale dei campi
provvigionali prima dell'implementazione del calcolo in Workspace. Non calcola
provvigioni, non usa percentuali fisse e non modifica il payload POST di OCM,
OCI o OCX.

## Uso per l'amministratore

1. Accedere con un utente amministratore e aprire **Impostazioni → Diagnostica
   contratti Mexal**.
2. Nel riquadro **Trasporto cliente e provvigione agente-prodotto**, inserire il
   codice del prodotto che ha una Categoria Provvigionale e il codice del cliente
   configurato per le provvigioni. Quegli stessi campi alimentano l'analisi.
3. Nel riquadro **Confronto documenti ordine**, inserire un OCM creato
   manualmente in Mexal (con cliente e articoli per cui Mexal ha calcolato le
   provvigioni) come **OCM manuale**, e un OCM creato da Workspace come **OCM
   Workspace**. Il formato è `OC+SERIE+NUMERO`.
4. Premere **Analizza provvigioni** e usare **Scarica report JSON** per allegare
   il risultato all'analisi tecnica, senza pubblicarlo: anche se sanitizzato,
   il file conserva struttura e dati tecnici rilevanti.

## Contenuto del report

Il report registra gli endpoint GET e gli stati HTTP, il JSON sanitizzato e i
percorsi ricorsivi che contengono `provvig`, `commission`, `categoria`,
`agente`, `percentuale` o `perc`. Per ogni percorso mostra tipo, esempio e
livello di affidabilità: i nomi trovati per corrispondenza sono **candidato**;
se nessun nome corrisponde viene emesso **non trovato**. Un endpoint senza errore
HTTP è mostrato come **verificato** nella tabella degli endpoint.

Per l'OCM manuale sono esposte separatamente le sezioni candidate per testata,
righe, percentuale, agente, matrici/strutture parallele e indici di associazione
riga. Il report include inoltre confronti strutturati tra prodotto Mexal/cache
Workspace, cliente Mexal/cache Workspace e OCM manuale/OCM Workspace.

La funzione usa esclusivamente GET verso le risorse di dettaglio già usate dalla
sincronizzazione (`/articoli/{codice}`) e dalle diagnostiche esistenti
(`/clienti/{codice}`, `/documenti/ordini-clienti/{riferimento}`), oltre alle
relative risorse `help.json`. Non effettua POST a Mexal.
