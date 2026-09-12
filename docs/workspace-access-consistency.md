# Workspace: ruoli, reparti e accessi

## Regole

- Il ruolo definisce operazioni e livelli. Le vecchie associazioni ruolo/area
  rimangono conservate ma non concedono più accesso alle aree.
- I reparti sono un unico elenco in `utenti_reparti`. Nessun reparto principale:
  il campo legacy `utenti.reparto_id` è nullo e vincolato a rimanere nullo.
- La migrazione trasferisce le precedenti appartenenze singole nell'elenco unico.
  Soltanto MERINO viene riallineata ai tre reparti Field Force autorizzati.
- I profili non amministratori con ambito "tutti" vengono limitati ai reparti;
  "propri" resta personale. I profili cliente mantengono il vincolo sul cliente.
- Un'area o un'eccezione personale può consentire una schermata senza abilitare
  il modulo completo. Il diniego sulla schermata prevale sui suoi accessi ereditati.
- I permessi del ruolo e dell'utente vengono uniti, applicando i dinieghi personali.
  Le operazioni restano limitate dal livello della schermata.

## Salvataggio e aggiornamento

`workspace_save_user_access` sostituisce atomicamente ruolo, elenco completo dei
reparti ed eccezioni. Mantiene ID e data di creazione delle eccezioni non rimosse.
`workspace_set_user_organization` è riservata al servizio amministrativo Edge:
elenco vuoto rimuove tutte le appartenenze, parametro nullo non modifica i reparti.
Anche Team e la precedente schermata Impostazioni usano l'elenco unico.

Il database pubblica soltanto un contatore di revisione, privo di dati personali.
Le sessioni ricevono la notifica Realtime e leggono un unico snapshot coerente.
Al ritorno alla finestra e ogni 30 secondi viene eseguita una verifica di recupero
(anche per scadenza delle eccezioni o notifiche perse). Le risposte tardive vengono
ignorate. Un errore di lettura revoca la copia locale, anziché riusare vecchi accessi.
Le pagine vengono ricreate quando cambia il perimetro effettivo, eliminando dati
locali precedentemente caricati. I controlli server leggono le regole correnti.

La schermata **Impostazioni → Verifica accessi** usa le stesse funzioni del
database per aree, moduli e schermate, senza simulare regole alternative.

## Rilascio e verifica

1. Applicare `20260912150000_workspace_access_consistency.sql`.
2. Aggiornare la funzione `admin-manage-user`, mantenendo `verify_jwt=true`.
3. Pubblicare il frontend da main.
4. Eseguire `supabase/tests/workspace_access_consistency.sql`: modifica solo una
   transazione di test e termina sempre con ROLLBACK (nessun test utente persistito).
5. Eseguire i test Node `workspace-screen-access`, `workspace-access-refresh`,
   `access-users-exceptions` e `AuthContext.test`, poi build e controllo produzione.

Le precedenti configurazioni normalizzate sono conservate nella tabella privata
`workspace_access_migration_history`, accessibile soltanto al servizio. Non vengono
eliminati utenti, progetti, task o storico operativo. Non ripristinare soltanto il
vecchio frontend: il modello non supporta più scritture del reparto principale.

Questa modifica riguarda Workspace e la sua gestione utenti. Non modifica il
codice o le sessioni autonome del server MES.
