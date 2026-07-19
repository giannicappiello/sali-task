# Automazioni Mexal
Le tabelle `mexal_automation_rules`, `mexal_automation_runs` e `mexal_automation_action_runs` memorizzano rispettivamente configurazione, esecuzioni e singole azioni idempotenti. Gli stati sono `queued`, `running`, `completed`, `failed` e `stopped`.

L'avvio manuale crea una run persistente; il dispatcher esegue le sole regole scheduled dovute con lock ottimistico. Lo stop è logico: preserva le azioni completate e impedisce le fasi successive. Le azioni supportate sono `sync_all`, clienti, condizioni commerciali, serie documenti, prodotti e giacenze. Gli agenti sono esclusi finché non esiste un endpoint verificato.

Il file vercel.json mantiene il cron giornaliero preesistente
/api/cron/mexal-dispatcher con pianificazione 0 23 * * *.
Le frequenze inferiori a un giorno richiedono uno scheduler esterno
o un piano Vercel compatibile configurato separatamente.
