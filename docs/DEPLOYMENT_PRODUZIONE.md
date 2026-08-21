# Pubblicazione in produzione

Il Workspace usa un rilascio controllato in tre fasi: **pubblica → verifica → promuovi**.

## Comando standard

```bash
npm run deploy:production
```

Il comando:

1. compila e verifica il progetto localmente;
2. crea un deployment di produzione staged;
3. controlla che il deployment sia `READY`;
4. verifica pagina principale e service worker PWA;
5. promuove esplicitamente il deployment;
6. conferma che `workspace.progre.it` punti alla stessa versione.

Se uno dei controlli fallisce, la procedura si interrompe prima della promozione. Non utilizzare il solo `vercel deploy --prod` come conferma dell’avvenuta pubblicazione sul dominio operativo.

