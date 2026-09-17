# Calendario aziendale Workspace → MES

## Comportamento

- Configurazioni HR → Calendario aziendale: orari settimanali con decorrenza, più fasce al giorno, aperture e chiusure giornaliere straordinarie. Modifiche riservate agli admin e registrate nell’audit HR.
- La versione iniziale conserva il calendario MES: lunedì–venerdì, 07:30–16:30. Non viene introdotta una pausa o modificata la convenzione di durata delle formule MES.
- Calendario e turni mostra ai dipendenti l’apertura aziendale, separata dal loro turno. Gli accordi economici restano nell’area admin.
- Precedenza: eccezione giornaliera → chiusura/festività → versione settimanale valida per la data. Le festività italiane sono calcolate da Workspace fino al 31 dicembre dell’anno corrente + 10. Le eccezioni possono riaprire un festivo.
- Le chiusure MES vengono importate una sola volta per contenuto, senza cancellare lo storico locale. Le chiusure su più giorni continuano a essere gestibili da Calendario e turni in Workspace.
- Il MES conserva la risposta valida in `App_Data/workspace-company-calendar.json`, con sostituzione atomica. Sincronizzazione alla lettura del planner, limitata a un tentativo ogni 30 secondi, timeout 10 secondi. In caso di indisponibilità usa la copia valida e mostra un avviso. Senza una prima copia valida interrompe la pianificazione.
- Ogni operazione confermata conserva le proprie fasce lavorative in `CalendarIntervalsJson`. Questo evita di contare notti/pause come lavoro e permette di rilevare modifiche successive senza nascondere barre o ridurre la durata. Per i piani precedenti si ricostruiscono le fasce usando il calendario storico MES.
- I conflitti sono visibili nel planner. Il recupero automatico dei ritardi non modifica i piani incompatibili; la ripianificazione resta un’azione del responsabile. Il controllo manuale conserva le durate già confermate.

## Attivazione coordinata

1. Applicare in Workspace `20260917160000_workspace_company_calendar.sql` e distribuire il frontend e l’endpoint `/api/workspace/company-calendar`.
2. Distribuire MES con la migrazione additiva `20260917075941_PreserveConfirmedCalendarIntervals`. L’updater MES punta esplicitamente a questa migrazione; non è abilitata l’applicazione indiscriminata delle migrazioni all’avvio.
3. Nel MES impostare `WorkspaceIntegration:CompanyCalendar:Enabled=true`. Riutilizzare `WorkspaceIntegration:WorkspaceUrl` e `WorkspaceIntegration:Secret`, corrispondente a `PROGREMES_INTEGRATION_SECRET` lato Workspace. Non inserire il segreto nel frontend.
4. Consentire al processo MES la scrittura nella propria cartella `App_Data`, conservata tra gli aggiornamenti. Aprire il planner per eseguire la prima acquisizione.
5. Verificare in Workspace «Ultimo collegamento MES», l’importazione delle chiusure esistenti e il piano MES. La gestione locale delle chiusure MES diventa consultazione dello storico, con collegamento a Workspace.

Il collegamento è disabilitato per impostazione predefinita, così la distribuzione del codice MES prima del servizio Workspace non interrompe il sistema. Il codice da solo non attiva il trasferimento in produzione.

Per tornare temporaneamente al calendario locale impostare il flag a `false`, conservando dati e cache. Dopo modifiche agli orari Workspace questo fallback non equivale al calendario centrale: verificare il piano prima di confermare nuove attività. La colonna aggiunta può restare nel database; non è necessario rimuoverla.

## Verifica

- Workspace: `node --test server/company-calendar.test.js server/hr.test.js server/hr-network.test.js`; i test PostgreSQL usano il runtime PGlite già previsto dai test HR in `.tmp/hr-test-runtime`.
- MES: `dotnet test Tests/Planning/ProgreMES.APS.Planning.Tests.csproj`. Il test HTTP di incorporamento necessita dell’accesso al server loopback locale.
- Build frontend `npm run build`; prova browser con dati fittizi dell’editor e del calendario, su desktop e smartphone.
- Copertura: equivalenza del piano Station/Filling iniziale, pause, sabati aperti, chiusure, decorrenze, durate dei piani confermati, autorizzazioni, importazione idempotente, cache dopo riavvio e indisponibilità del servizio.

## Confine di questa modifica

Questa modifica trasferisce il calendario aziendale. Non crea ancora il collegamento nominativo fra dipendenti Workspace e operatori MES, la sincronizzazione delle ferie personali, il catalogo competenze o le proposte di sostituzione. I vincoli MES già presenti su organico, ruoli, assenze locali, impianti e materiali restano attivi.
