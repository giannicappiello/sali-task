# Fase 1B - client read-only ProgreMES

## Confine architetturale

Il browser Workspace chiama esclusivamente endpoint same-origin sotto
`/api/progremes/*`. Un rewrite Vercel inoltra le richieste alla funzione Node
consolidata `api/mexal/automation.js`, che:

1. valida la sessione Supabase dell'utente;
2. verifica che il profilo sia attivo e abbia accesso al modulo Workspace
   `progremes` tramite `workspace_module_enabled_for_user`;
3. valida risorsa, paginazione e filtri con allow-list esplicite;
4. chiama l'API MES aggiungendo `X-Workspace-Secret` solo server-side;
5. valida e proietta la risposta sui soli DTO pubblici previsti.

Non sono presenti operazioni `POST`, `PUT`, `PATCH` o `DELETE` verso
ProgreMES. `suppliers` non appartiene all'allow-list.

## Configurazione Vercel

Configurare nel pannello Vercel, con scope separato per Preview e Production:

- `PROGREMES_API_BASE_URL`: base completa, per esempio
  `https://mes.example.invalid/api/workspace/v1/`;
- `PROGREMES_WORKSPACE_SECRET`: secret machine-to-machine ProgreMES;
- `PROGREMES_API_TIMEOUT_MS`: opzionale, default `10000`, intervallo
  consentito `1000-30000` millisecondi.

Queste variabili sono esclusivamente server-side. Non usare il prefisso
`VITE_`, non copiarle in file versionati e non inserirle nei log. In assenza
del base URL o del secret il client rifiuta la richiesta.

## Endpoint interni predisposti

Tutti gli endpoint richiedono `Authorization: Bearer <sessione Workspace>`.

| Endpoint Workspace | Endpoint MES | Filtri consentiti |
| --- | --- | --- |
| `GET /api/progremes/status` | `/status` | nessuno |
| `GET /api/progremes/clients` | `/clients` | `page`, `pageSize`, `search`, `active`, `updatedAfter` |
| `GET /api/progremes/articles` | `/articles` | `page`, `pageSize`, `search`, `active`, `updatedAfter` |
| `GET /api/progremes/production-orders` | `/production-orders` | `page`, `pageSize`, `search`, `status`, `from`, `to` |
| `GET /api/progremes/production-progress` | `/production-progress` | `page`, `pageSize`, `search`, `status`, `from`, `to` |
| `GET /api/progremes/inventory` | `/inventory` | `page`, `pageSize`, `search`, `status`, `updatedAfter` |
| `GET /api/progremes/planning` | `/planning` | `page`, `pageSize`, `search`, `status`, `from`, `to` |

`pageSize` e limitato a 500, `page` a 100000, `search` a 200 caratteri e
`status` a 64 caratteri. Parametri sconosciuti, ripetuti o non validi vengono
rifiutati. Il browser non puo specificare URL o path MES arbitrari.

## Collegamento di rete

Non e stata applicata alcuna configurazione di rete. Le alternative valutate
sono:

1. **Endpoint HTTPS pubblico dietro reverse proxy**: semplice, ma espone un
   ingresso Internet da proteggere con TLS, rate limiting, autenticazione forte
   e monitoraggio. L'allow-list IP e fragile con l'egress Vercel standard, che
   usa indirizzi dinamici; IP statici richiedono funzionalita Vercel dedicate.
2. **Tunnel outbound**: un connettore sul server MES apre soltanto connessioni
   in uscita e pubblica un hostname HTTPS senza esporre direttamente l'IP o
   aprire porte inbound. Cloudflare Tunnel documenta questo modello
   outbound-only e supporta piu connettori per alta disponibilita:
   <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/>.
3. **VPN/site-to-site**: adeguata se esiste gia una rete privata fra hosting e
   azienda. Vercel Secure Compute offre connettivita privata dedicata, ma e una
   scelta Enterprise; gli IP statici sono una soluzione distinta per semplice
   allow-list egress:
   <https://examples.vercel.com/kb/guide/can-i-get-a-fixed-ip-address>.
4. **Relay applicativo**: evita ingresso diretto sul MES, ma aggiunge un nuovo
   servizio, stato operativo, code, osservabilita e potenziale persistenza dei
   dati. Non e giustificato per semplici letture sincrone se il tunnel e
   disponibile.

### Soluzione consigliata

Usare un **Cloudflare Tunnel outbound** dedicato all'API read-only, con hostname
separato e Cloudflare Access davanti al tunnel. L'identita machine-to-machine di
Vercel dovrebbe essere un **Access Service Token**, revocabile e ruotabile,
oltre al gia previsto `X-Workspace-Secret`. I service token sono progettati per
client automatici e richiedono una policy `Service Auth`:
<https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/>.

Motivazioni:

- nessuna porta inbound o IP pubblico sul server MES;
- TLS e policy applicati prima di raggiungere l'origine;
- doppio controllo: identita del backend Workspace e secret applicativo MES;
- revoca e rotazione indipendenti;
- log e policy centralizzati;
- possibilita di eseguire piu connettori per resilienza.

Prima dell'attivazione serviranno una decisione infrastrutturale esplicita,
l'installazione gestita del connettore e un piccolo hardening del client per i
due header Access, conservati come ulteriori variabili server-side Vercel.
Queste operazioni non fanno parte della Fase 1B corrente.
