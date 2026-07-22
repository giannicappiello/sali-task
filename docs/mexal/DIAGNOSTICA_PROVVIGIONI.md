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

## Regole provvigionali: stato della sincronizzazione

L'analisi del repository (client WebAPI, API Vercel, Edge Function, diagnostiche e
help JSON versionato disponibile) **non identifica un endpoint Mexal verificato**
che restituisca una collezione di regole provvigionali. I soli campi confermati
sono quelli già presenti nei dettagli cliente/articolo (`cod_cat_pr` e
`id_categoria_pr`) e nei documenti ordine; sono identificativi di categoria, non
una formula da cui derivare una percentuale. Perciò questa PR non implementa
`sync-commission-rules` e non modifica `mexal_regole_provvigioni`.

Gli amministratori possono usare **Impostazioni → Diagnostica contratti Mexal →
Regole provvigionali → Analizza endpoint candidati**. La chiamata usa soltanto
GET verso `/help.json` e gli help candidati per `agenti`, `condizioni-agenti`,
`provvigioni`, `condizioni-commerciali`, `tabelle-generali` e
`tabelle-personalizzate`. Per ogni risposta espone solo status HTTP, chiavi,
tipi e al massimo tre record con scalari non sensibili; non registra né restituisce
payload completi e non esegue scritture.

Per completare una sincronizzazione reale serve una risposta Mexal/help che
confermi: percorso GET, paginazione, identificativo stabile della regola,
categoria cliente, categoria prodotto, eventuale agente, percentuale e date di
validità/priorità. Solo allora potrà essere definita la mappatura verso
`categoria_cliente`, `categoria_prodotto`, `codice_agente_mexal`, `percentuale`,
`valida_dal`, `valida_al`, `origine` e `dati_mexal`, con upsert transazionale e
disattivazione esclusivamente dopo una lettura completa riuscita.

La tabella Workspace è protetta da RLS: gli amministratori possono leggerla, gli
utenti autenticati non hanno policy di scrittura, e l'eventuale futuro sync usa
solo la service role lato server. La precedenza già implementata resta invariata:
una regola agente specifica precede quella generale. Nessuna percentuale viene
inventata; la regola verificata 2 + 3 = 7,5% rimane quella introdotta in PR #81.
