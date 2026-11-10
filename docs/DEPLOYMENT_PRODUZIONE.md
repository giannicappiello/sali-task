# Pubblicazione in produzione

Il Workspace usa un rilascio controllato in tre fasi: **pubblica → verifica → promuovi**.

## Comando standard

```bash
npm run deploy:production
```

Il comando:

1. compila e verifica il progetto localmente;
2. applica le migrazioni Supabase al progetto collegato e ne esegue le verifiche contrattuali;
3. crea un deployment di produzione staged;
4. controlla che il deployment sia `READY`;
5. verifica pagina principale e service worker PWA;
6. promuove esplicitamente il deployment;
7. conferma che `workspace.progre.it` punti alla stessa versione.

Le migrazioni sono idempotenti e la verifica HR interrompe il rilascio se
`public.workspace_hr_admin_request(jsonb)` non esiste, ha una firma diversa o
non è eseguibile dal ruolo `authenticated`. Vercel da solo non aggiorna il
progetto Supabase: non considerare riuscito un rilascio che salti il passaggio
`supabase db push --linked`.

Se uno dei controlli fallisce, la procedura si interrompe prima della promozione. Non utilizzare il solo `vercel deploy --prod` come conferma dell’avvenuta pubblicazione sul dominio operativo.


## Salvaguardie del rilascio

Il comando fissa Supabase CLI 2.116.0 e Vercel CLI 65.12.1. Il push usa --skip-vault e non aggiorna segreti Vault. Il deployment usa --prod --skip-domain: i domini vengono assegnati soltanto dal passaggio esplicito di promozione, dopo i controlli.

Prima del rilascio verificare separatamente la storia delle migrazioni e il contratto public.workspace_hr_admin_request(jsonb): deve esistere ed essere eseguibile da authenticated. Un push no-op non riesegue le verifiche contenute nelle vecchie migrazioni. Per una riconciliazione solo metadata, fermarsi se il dry-run propone qualsiasi SQL, seed o ruolo. Conservare gli audit di adozione amministrativa senza interpretarli come prova di esecuzione storica.
