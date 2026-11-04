# Chat dei clienti Private: solo team Progrè

La migrazione `20261104110000_private_customer_chat_team_only.sql` riconosce gli account cliente dalle associazioni `workspace_customer_user_links`, dal ruolo Cliente/Customer e dal reparto Cliente Private (primario o aggiuntivo). Un ruolo come Responsabile reparto o Admin non scavalca questa classificazione.

Un account cliente può contattare soltanto utenti attivi del team, esclusi altri clienti e il ruolo Collaboratore esterno. I membri interni possono rispondere; fra membri interni restano valide le regole preesistenti per reparti, responsabili e amministratori.

La directory restituisce flag espliciti per la selezione nell'interfaccia. La protezione effettiva resta nel database: `chat_pair_allowed` e `chat_members_compatible` vengono usate dalle RPC e dai trigger già esistenti per creazione chat, gruppi, partecipazioni, invio messaggi e allegati. Un gruppo con due clienti resta incompatibile anche se contiene un amministratore. Le chat precedenti tra clienti non consentono nuovi invii; lo storico non viene eliminato.

Il gruppo di reparto creato da un cliente include soltanto il personale di quel reparto. Nell'interfaccia i clienti vedono la rubrica Team Progrè e l'indicazione esplicita della limitazione.

Verifica isolata: eseguire i test JavaScript e il test PostgreSQL con `@electric-sql/pglite@0.5.14` disponibile, oppure con `PGLITE_MODULE` impostato al file URL del runtime:

```sh
node --test --experimental-test-isolation=none test/chat-directory.test.mjs supabase/tests/private_customer_chat_team_only.mjs
```

La suite esercita le funzioni SQL e i trigger reali in un database usa e getta. Non invia messaggi in produzione. Dopo il rilascio applicare la sola migrazione prevista, registrarne la versione e verificare che nessuna coppia di clienti distinti risulti autorizzata. Verificare anche la possibilità di contattare il team e i flag della directory.
