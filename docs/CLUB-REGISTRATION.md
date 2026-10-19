# Apertura iscrizioni Club

La disponibilità delle iscrizioni è restituita dal database con `club_public_info().registration_available`. I pulsanti Consumatore e Rivenditore usano questo dato; nascondere il messaggio di chiusura nel frontend non apre il servizio.

Il CRM deve avere un responsabile amministratore attivo e due documenti pubblicati nella sezione SalidischiaClub → Regolamento e privacy. La sola presenza delle bozze non basta. La pubblicazione aggiorna gli indirizzi interni dei documenti e conserva la versione accettata nelle iscrizioni.

Per verificare lo stato senza leggere dati personali:

```sql
select jsonb_build_object(
  'registrazioni_aperte',club_public_info()->'registration_available',
  'cashback',club_public_info()#>'{program,cashback_percent}',
  'regolamento',club_public_info()->'terms_url',
  'privacy',club_public_info()->'privacy_url'
);
```

Dopo una modifica verificare la pagina pubblica, l'abilitazione di entrambi i tipi di iscrizione e il riconoscimento di una partita IVA reale del CRM. Conferma email e autorizzazioni restano obbligatorie: non creare account fittizi di produzione per collaudare l'interfaccia. La verifica dell'invio e della ricezione dell'email richiede una casella effettivamente controllata dal destinatario.

Il test `test/club-registration-readiness.test.mjs` copre il passaggio da configurazione incompleta a iscrizioni aperte su un database isolato.
