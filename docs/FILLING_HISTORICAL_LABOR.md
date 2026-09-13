# Manodopera FILLING: media storica pezzi per turno

## Attivazione

1. Aggiornare MES da main con la procedura ordinaria.
2. In **CONFIGURAZIONE COSTI PRODUZIONE**, sezione FILLING, scegliere
   **Media storica pezzi per turno**, oppure chiederlo all'IA integrata.
3. Verificare la produttività storica e salvare una nuova versione con decorrenza.
   Una proposta IA richiede conferma, trasferimento al modulo e salvataggio:
   la sola conversazione non modifica i criteri.
4. In **CONSUNTIVI PRODUZIONI** importare/aggiornare lo storico MES.

La tariffa unica resta condivisa con STATION. Organico Confezionamento attivo
letto da MES, non modificabile dalla proposta IA. Nessun costo orario macchina.

## Formula

- Costo turno reparto = addetti Confezionamento attivi × tariffa ora/uomo × 8.
- Produttività = pezzi buoni delle lavorazioni **Confezionamento concluse**
  / turni completati dell'intero reparto.
- Costo unitario = costo turno / produttività.
- Preventivo = costo unitario × pezzi previsti dell'ordine, conteggiati una volta.
- Consuntivo = costo unitario × pezzi buoni chiusi della lavorazione.

Non moltiplicare ulteriormente per turni o presenze della singola lavorazione.
QuantitaProdotta MES è già quantità buona: gli scarti non vengono sottratti due volte.
Le quantità preventive sono ripartite fra le lavorazioni FILLING in proporzione
alle quantità registrate, oppure in parti uguali prima della loro disponibilità.

## Calendario, storico e astucciatura

Stesso calendario economico STATION: primo turno MES attuale applicato anche
allo storico, fine settimana e chiusure datate rispettati, turni Workspace dal
secondo aggiuntivi e non sovrapposti. Denominatore dalla prima attività FILLING
all'ultimo turno completato; include turni inattivi, esclude quello in corso.
Pezzi di lavorazioni ancora aperte o concluse nel turno corrente esclusi dalla media.

La media viene riletta a ogni consultazione/aggiornamento, senza polling UI.
La modalità attiva ricalcola anche le produzioni concluse, senza alterare
formula, SL, quantità MES o configurazioni originali.
Niente dati/media zero/organico assente/unità non in pezzi: costo non calcolabile.
Unità pezzi supportate: PZ, PCS, PEZZI; nessuna conversione da KG.

**Astucciatura separata**: mostra pezzi e lavorazioni separati, non li somma
alla produttività FILLING. Nessun addebito autonomo al momento, perché il costo
di reparto comprende già l'organico Confezionamento. I prodotti che richiedono
astucciatura conservano la quantità finale della fase per il costo prodotto finito.
Un'astucciatura senza FILLING collegata resta con costo reparto non attribuibile.

## Metodo alternativo e IA

Il precedente metodo **Ore pianificate e presenze effettive** resta disponibile
come filling.basis=presence_hours. Il nuovo metodo è historical_pieces.
L'IA può proporre il passaggio fra i due, con anteprima deterministica e salvataggio
versionato. I criteri dell'altro metodo sono conservati ma inattivi; nessuna
esecuzione di formule/code/SQL generati dall'IA.
Un costo autonomo astucciatura richiederà un criterio futuro di ripartizione
dell'organico: non viene attivato né simulato con campi impropri.

## Evidenze e compatibilità

Endpoint MES interno: production-cost-filling-history.
Riepilogo con periodo, pezzi FILLING, pezzi astucciati, chiusure, turni, organico,
produttività, costo turno, costo unitario e identificativo della revisione.
I dettagli globali delle lavorazioni non sono restituiti al browser.

Si riutilizza l'archivio JSON immutabile esistente production_cost_station_history
(nome storico della tabella), con fingerprint prefissato FILLING e sorgente
marcata economicDepartment=Confezionamento. Nessuna modifica alla tabella/RLS;
nessuna nuova migrazione DB. Sono richiesti i permessi già installati dalla
migrazione 20260913130000 (service_role INSERT/SELECT; nessun accesso browser).
Snapshot STATION precedenti e relativi fingerprint restano invariati.
