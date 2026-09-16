# Pianificazione versionata Workspace–MES

## Pubblicazione e attivazione sono separate

La migrazione aggiunge tabelle, catalogo e funzioni. Non attiva il nuovo motore,
non ricalcola il piano operativo e non crea OP, lotti, SL o CL.
Installare entrambi i rilasci prima dell'attivazione. Il vecchio MES restituisce
un messaggio di aggiornamento richiesto, senza tentare operazioni alternative.

Schermate autonome in Produzione / Gestione produzione:

- **Versioni e revisioni del piano** (`/versioni-piano-produzione`).
- **Rilascio ODL** (`/rilascio-odl`).

Entrambe sono nel catalogo. L'uso manuale richiede il permesso operativo MES,
non il modulo IA. L'assistente conserva i propri controlli di ruolo e conferma.

## Prima attivazione

1. Verificare un backup ripristinabile del database MES e dei documenti.
2. Aprire Versioni e revisioni del piano, motivare e calcolare l'anteprima MIGRATE.
3. Controllare confronto prima/dopo, lavorazioni protette, date, risorse,
   operatori, materiali e blocchi. Nessuna variazione operativa nella simulazione.
4. Confermare la verifica del backup e dell'anteprima, quindi la conferma finale.
5. Se i dati sono cambiati o l'anteprima ha oltre 30 minuti, ricalcolarla.

L'archivio tecnico di ogni simulazione conserva lo stato sorgente (ordini,
planning, produzioni, materiali, impegni, stock, formule, lotti e prelievi).
Non è un sostituto del backup del database e dei file. Versioni precedenti,
identificativi, lotti esistenti e documenti non vengono eliminati.
Completate e annullate restano storico; avviate/sospese sono protette per fase.
Il residuo di un OP può essere riprogrammato senza ripetere il semilavorato concluso.

## Flusso attivo

Conferma RdP → previsione di capacità (giallo, senza OP o prenotazioni fisiche).
Conferma piano → OP nell'orizzonte configurato (predefinito 60 giorni),
fabbisogni logici e capacità; nessun lotto o impegno fisico anticipato.
Revisione → ricalcolo, di norma 30 giorni, con disponibilità e arrivi.
Genera ODL → rilascio delle fasi/batch degli OP nella finestra congelata
(predefinita 7 giorni), prenotazioni fisiche e verifica/attribuzione lotti.
L'avvio, il controllo qualità, SL e CL restano azioni operative separate.

L'orizzonte è in giorni dalla data scelta, non una cancellazione dello storico.
Le scelte manuali richiedono una revisione e non spostano direttamente gli ODL.
Per modificare priorità nella finestra congelata utilizzare Revisione priorità:
il rilascio interessato è revocato con tracciamento e va nuovamente verificato.
I legami semilavorato–confezionamento sono mantenuti; la copertura materiale
non viene duplicata fra le fasi. Le date commerciali originali restano distinte
da stima e consegna confermata.

Il controllo settimanale produce una proposta, non applica un piano.
La proposta automatica deve essere ricalcolata con i dati correnti dall'utente
prima della conferma. Nessun avvio automatico delle lavorazioni.

## Errori e riconciliazione

- Esito lotti Mexal incerto: stato **Da riconciliare**. Non ripetere la creazione.
  Verificare/riallineare i lotti già esistenti, poi **Verifica lotti riconciliati**.
- MES applicato ma mirror Workspace non aggiornato: **Allinea stato Workspace**.
  Non ripetere conferma piano o rilascio.
- Impegni ambigui o materiali non coperti: correggere tramite revisione controllata;
  non inventare giacenze o ignorare i blocchi di tracciabilità.
- Ripristino diretto disponibile solo per l'ultima revisione di capacità, finché
  lo stato non è cambiato. Dopo conferme/rilasci/produzioni serve una revisione
  compensativa; non si cancellano operazioni reali o documenti.
- Revisione di quantità/formula di una RdP già confermata: non è uno spostamento
  di calendario. Il percorso legacy di sostituzione viene bloccato nel nuovo
  sistema; usare annullamento controllato e nuova domanda quando consentito,
  mai ricreare un OP che ha già produzioni o documenti.

## IA

MES_PLAN_STATE legge stato, ordini e versioni; MES_PLAN_SIMULATE prepara
un'anteprima; MES_PLAN_STATUS rilegge una versione. MES_PLAN_APPLY e
MES_ODL_VERIFY sono proposte auditate con conferma esplicita e nuova verifica
di identità, permessi e impronta dei dati. L'IA non può attestare da sola
l'esistenza del backup, approvare autonomamente il proprio piano o aggirare
blocchi, tracciabilità e riconciliazione Mexal.

## Verifica dopo aggiornamento MES

Prima di attivare, aprire entrambe le schermate e verificare modalità inattiva
e lettura dello stato. Fare un'anteprima MIGRATE e confrontarla con il piano
reale. Solo dopo verifica del backup autorizzare l'applicazione. La pubblicazione
è verificata con test automatici e UI simulata; non sostituisce questa verifica
sui dati produttivi né autorizza una migrazione automatica.
