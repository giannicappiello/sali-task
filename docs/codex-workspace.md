# Codex nella chat Workspace/MES

Il backend `AI_RUNTIME=codex-agents` usa la **OpenAI Agents API**, cioè il motore Codex gestito da OpenAI. Non è una rinomina del modello usato da `generateText` e non trasferisce una chat del desktop.

## Attivazione

1. Applicare `20260929160000_codex_workspace_sessions.sql` e registrarla nel registro migrazioni.
2. Configurare `OPENAI_API_KEY` come segreto server Production. Servono `api.agents.read`, `api.agents.write` e `api.responses.write`. Fatturazione API del progetto OpenAI.
3. Verificare accesso API e modello con un test senza dati aziendali. Il modello predefinito è `gpt-6-astra`; l'override server è `CODEX_MODEL`.
   Il controllo `POST /api/mexal/automation?route=codex-health` richiede il Bearer del worker/cron già configurato: esegue solo un ciclo fisso con uno strumento fittizio, senza dati aziendali, ed elimina la sessione di prova. Non accetta prompt o strumenti dal chiamante.
4. Impostare `AI_RUNTIME=codex-agents` e pubblicare. La risposta `capabilities.runtime` e il titolo della chat identificano il motore attivo.
5. Provare una lettura autorizzata, un seguito nella stessa chat e una proposta operativa senza confermarla. Controllare `ai_codex_runs`, `ai_codex_calls` e `ai_messaggi`. L'applicazione effettiva resta nella scheda di conferma esistente.

Per disattivare nuovi lavori Codex rimuovere `AI_RUNTIME`. Non cambiare motore durante un'operazione pendente; interrompere prima il lavoro. Non è previsto un fallback silenzioso in caso di errore del provider.

## Esecuzione e recupero

- Una sessione remota per conversazione e configurazione/autorizzazioni. Una variazione di scope interrompe il turno pendente; il turno successivo usa una nuova sessione e lo storico Workspace.
- Ogni messaggio ha un UUID stabile, una registrazione persistente e un solo lavoro pendente per conversazione. Il browser riceve subito il riferimento e prosegue con richieste limitate nel tempo.
- Le richieste di continuazione usano l'identità Workspace corrente. Nessun token utente viene salvato nel database o inviato al modello.
- Le chiamate passano solo dagli strumenti del ruolo corrente, con validazione JSON Schema. Conferme, firme MES, limiti e vincoli del dominio restano nei servizi esistenti. Non sono esposte shell o credenziali.
- Il risultato di ogni chiamata viene salvato prima dell'invio al provider. Se una chiamata risulta avviata ma senza risultato persistito, non viene ripetuta: il motore riceve l'incertezza e deve verificarne l'esito.
- L'esito finale viene salvato atomicamente con la rendicontazione dei token. Una sessione `idle` non equivale a successo: serve il turno `completed` e un messaggio `final_answer`.
- Chiudendo la pagina, OpenAI può continuare il ragionamento; le successive chiamate agli strumenti attendono la riapertura della chat autenticata. Non è un worker operativo senza presidio.
- `Interrompi` cancella il turno, senza annullare operazioni già eseguite. La cancellazione della chat elimina le sessioni remote note prima dei dati locali.

## Limiti espliciti

L'API Agents accetta testo e immagini con URL fino a 1 MiB. PDF e immagini oltre questo limite continuano attraverso il lettore documenti Workspace già presente; la risposta lo identifica esplicitamente. Il turno Codex successivo riceve anche questo storico.

Il provider restituisce i token, non il prezzo del turno: `usage.cost=null` e `costSource=not_reported` indicano costo non disponibile, non gratuità. La fatturazione autorevole è nel progetto OpenAI. La rendicontazione monetaria locale preesistente non costituisce un limite di spesa del provider.

## Verifiche

`node --test server/ai/codex-agent.test.js` verifica ripresa, deduplicazione, argomenti, scope, stati terminali e il percorso diagnostica materiali → nuova anteprima → proposta da confermare usando un provider simulato. Non prova la correttezza del modello reale.

`scripts/codex-session-regression.sql` va eseguito in una transazione con rollback; verifica proprietà, lease, concorrenza, finalizzazione idempotente e confini dei privilegi.

Fonti ufficiali: [Agents API](https://developers.openai.com/api/docs/guides/agents-api/overview), [funzioni](https://developers.openai.com/api/docs/guides/agents-api/tools/functions), [sessioni](https://developers.openai.com/api/docs/guides/agents-api/sessions).
