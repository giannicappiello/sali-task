# Verifica del pacchetto Assistente AI — 24 settembre 2026

## Stato del rilascio

Pacchetto in verifica, non pubblicato in produzione. Le cinque migrazioni Workspace sono state verificate con rollback e applicate
in una sola transazione autorizzata; nessuna migrazione MES eseguita sul server. Il coordinatore è installato sul PC in
`C:\AssistenteAI\Coordinator`, ma non ancora associato a Workspace né avviato
come attività pianificata. Non è stata verificata una generazione remota completa.

## Risultati verificati

- Workspace: compilazione con pnpm 10.28.0 e lockfile del progetto riuscita nel
  contenitore senza rete; 116 test AI superati, zero fallimenti, un test PDF
  saltato perché richiede un documento di regressione esterno. Il test che legge
  anche il repository MES è eseguito separatamente sul PC.
- Ulteriore verifica delle azioni controllate: 10 test superati, incluso il
  vincolo della proposta alla versione corrente della schermata.
- MES: 10 test mirati superati (formule, evidenze sui tempi, destinazione della
  migrazione). Corretto il target di aggiornamento alla migrazione additiva
  `20260923194325_AddAiOperationalActionAudit`.
- La suite MES completa ha inizialmente riportato 14 fallimenti. Il confronto
  con il commit originale, nello stesso contenitore, riproduce 13 fallimenti:
  font Arial assente, Windows PowerShell non disponibile, configurazioni escluse
  dal trasferimento e comportamento delle route su Linux. Il quattordicesimo
  era il target della migrazione ed è stato corretto e verificato.
- Suite completa MES su Windows: 919 test riusciti, zero fallimenti, 7 saltati.
- Suite portabile nel contenitore MES: 903 riusciti, zero fallimenti, 7 saltati.
  I 16 casi dipendenti dall’ambiente Windows restano nel controllo di rilascio
  completo; il controllo isolato dichiara esplicitamente questa copertura.
- Le cinque migrazioni Workspace sono state eseguite su PostgreSQL temporaneo
  senza rete, con dati di prova: verifica di permessi revocati, approvazioni,
  aggiornamenti atomici, replay, versioni superate, assegnazione esclusiva dei
  lavori e vincolo alla revisione Git.
- Tre prove del worker con API simulata e container reale: successo immediato,
  errore persistente senza commit e correzione dopo un test fallito.
  Il checkout originale rimane invariato in entrambi i casi.
- Preview Vercel `sali-task-5wt6iewty-progre1.vercel.app`: build READY e API worker
  verificata con risposta 401 a richiesta senza identità.
- Interfaccia locale: pannello AI sopra il popup operativo, cronologia condivisa,
  conferma sopra il pannello e conservazione dei campi originali alla chiusura.

## Verifiche di attivazione da chiudere

1. Associazione protetta del PC e verifica autenticata del modello, della coda
   e dell’avvio automatico.
2. Conferma del risultato su Workspace pubblicato e sul server MES aggiornato.
   La compilazione locale non certifica l'installazione del server.

## Pubblicazione

Workspace e MES sono repository distinti: richiedono due revisioni Git coordinate.
Nessun push o aggiornamento del server è implicito nella creazione di un ramo AI.
Il processo mantiene i test bloccanti e non trasforma un risultato incompleto in
un successo. L’associazione del PC e la verifica del server sono passaggi di
attivazione distinti dalla pubblicazione dei sorgenti.
