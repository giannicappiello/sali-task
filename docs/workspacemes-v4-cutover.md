# WorkspaceMES V4 — cutover

## ProgreMES

Nel file `appsettings.json`, sotto `WorkspaceIntegration:ProductionFlow`:

```json
"ReceiveV2ProductionRequests": false,
"ReceiveV2OperatorDecisions": false,
"ExecuteV2Production": false,
"ReceiveV3ProductionPreviews": false,
"ConfirmV3Production": false,
"ReceiveV4ProductionPreviews": true,
"ConfirmV4Production": true
```

Eseguire `Deployment/RemoteDesktop/AGGIORNA-PROGREMES.ps1`. La migration minima richiesta è
`20260829174406_WorkspaceMesV4LifecycleDelta`.

## Workspace / Salitask

Impostare in Production:

```text
WORKSPACEMES_V3_PREVIEW_ENABLED=false
WORKSPACEMES_V3_CONFIRM_ENABLED=false
WORKSPACEMES_V4_PREVIEW_ENABLED=true
WORKSPACEMES_V4_CONFIRM_ENABLED=true
```

Applicare la migration `20260829234500_workspacemes_v4_full_mes.sql` prima di promuovere il frontend/API.
La migration spegne i gate Supabase V3, imposta il contratto predefinito a V4 e crea esclusivamente
mirror MES e fabbisogni acquisto: nessun impegno produttivo viene materializzato da Workspace.

## Collaudo

1. Il Centro diagnostico deve mostrare `receiveV4Previews=true` e `confirmV4Production=true`.
2. Una nuova RdP deve riportare `Contratto V4`.
3. La preview deve contenere materiali certificati MES e non deve leggere distinte o giacenze Workspace.
4. `COMPLETE` crea OdP e impegni in MES; `WITH_SHORTAGES` crea inoltre i fabbisogni acquisto in Workspace.
5. Le RdP V2/V3 non sono riutilizzate dal flusso operativo V4.
