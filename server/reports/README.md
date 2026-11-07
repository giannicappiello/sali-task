# Commercial report delivery

ChatGPT generates the PDFs under the existing Business workspace identity.
Vercel triggers the published Workspace Agent API channel; no Platform model
API key or external generation call is used. The existing Aruba order-mail
service sends the attachments with its unchanged sender configuration.

## Distribution

- The 14 selected active agents receive their own individual report.
- Managers receive only their linked agents' reports, their own if applicable,
  and a consolidated report for their team with an agent ranking. Identical
  team/network reports reuse the same PDF.
- One central envelope to ordini@progre.it and giovanni.cappiello@progre.it
  contains all 14 individual reports and the two PR/PH consolidated reports.
- Professional uses invoices; Farmacie uses ordiniph. The networks are never
  combined into a misleading revenue total.

Preparation starts on day 9; delivery starts on day 10 at 10:00 Europe/Rome.
The UTC cron has summer/winter candidates, with local-time gating in Node and
an independent delivery-time gate in PostgreSQL. A delayed cron within the
scheduled hour is accepted. It does not create a second monthly batch.

## Deployment and activation

1. Apply the matching migration to the sali-task Supabase project.
2. Publish this backend/frontend to workspace.progre.it.
3. Update only hosting/aruba-order-email/worker.php on the current Aruba
   hosting, preserving config.php and its existing credentials/sender.
4. Publish the intended ChatGPT agent API channel. Use a Workspace Agents
   access token, not a Platform API key or Codex-only token.
5. In the agent, allow the three COMMERCIAL_REPORT tools. Business mutation
   tools remain disabled; no BRAIN_REVIEW confirmation is automated.
6. Open /settings/commercial-reports as the intended Workspace administrator,
   review recipients and enter the trigger ID/token. Explicitly activate the
   fixed monthly plan. The server verifies contacts and worker capabilities.

Until step 6, no plan is active. No deployment or migration creates report
emails on its own. Agent generation and a live delivery test must be verified
separately before claiming the entire workflow is operational.

## Safety and recovery

All execution tables are server-only with RLS enabled and client grants
revoked. Credentials are authenticated-encrypted, bound to the approving
owner, and never returned to the browser. The plan can be paused at any time.
Current owner authority, agent activity, contacts and team membership are
rechecked. Changes between generation and delivery stop the old envelope.

Uploads must match the batch manifest, month, source, network, PDF syntax,
SHA-256 and size limits. All expected PDFs must exist before the envelopes
are atomically queued. Recipients cannot be supplied by the agent.

The worker marks an envelope uncertain before returning any attachments.
Transport loss or an ambiguous mail/acknowledgement never causes an automatic
resend. Check the mail server and per-envelope state before manual recovery.
`sent` means accepted by the existing mail service, not proof of inbox delivery.

`GET ?action=report_capabilities` is a read-only authenticated probe. Never
probe old workers with an unknown POST action: they may consume order emails.
The dedicated `run_reports` action cannot consume order/shipment jobs.

## Verification

Node tests cover destination isolation, manager overlap, group reuse, DST,
partial batches, PDF integrity, delegation changes and duplicate prevention.
The PHP harness tests MIME, unchanged sender, private attachments, SHA failure,
acknowledgement and report-only claims without networking or mail(). SQL probes
run in a rolled-back transaction to validate server-only grants, atomic queue
idempotency and the independent no-early-send gate.
