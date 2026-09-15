# Mexal: scheduling and priority refresh

## Schedule

Daily eligibility is 21:30 in `Europe/Rome`. PostgreSQL and the dispatcher use
the same local business-date boundary, including daylight-saving transitions.
The existing Aruba ten-minute trigger remains the primary wake-up; Vercel's
22:00 UTC trigger remains a fallback. Starting at 21:30 does not guarantee an
overnight completion deadline when Mexal is slow or unavailable.

The historical `daily-2300:` **identity key is intentionally retained** to avoid
creating a second cycle for a date that already has one. This is an identifier,
not the execution time. Existing cycles, jobs, run IDs and offsets are not reset.

## Manual Workbench refresh

`Aggiorna` enqueues an independent `oct_orders` job with `manual_priority` lane.
Repeated requests attach to an existing manual request or an OCT actually
executing; they do not attach to an automatic OCT queued behind stocks.
The service-role RPC claims this lane before scheduled work. A global dispatch
lock and an unexpired-lease check prevent interruption of the current batch.
The scheduled fallback excludes manual jobs so it cannot bypass their checks.
Existing run-level, document identity and line upsert safeguards remain in place.

The authenticated background wake-up targets a fixed Workspace endpoint. It
does not depend on keeping the browser open. An OCT pass gets a fresh function
time budget rather than starting at the end of an almost-expired worker call.
Retries retain checkpoints and worker/token ownership checks. Scheduled wake-ups
remain the recovery path when a background wake-up fails.

Workbench displays queued/running/retrying/completed/failed states, phase counts,
import count and warnings, and the date of the latest successful job. An automatic
queued OCT does not disable the manual button. A running OCT does.

## New-run optimizations and compatibility

New product/stock runs use `metadata.inputs_version = 1` and persist their article
catalog, group references and warehouse list in `mexal_sync_run_inputs` once.
This avoids repeatedly paging the complete catalog for every small batch and
keeps article ordering stable between function invocations.

Stock quantities, commitments and costs are **not** cached in this snapshot:
they are read live for each article. An already-read warehouse detail is reused
only for the same warehouse in the same batch. New stock snapshots do not fetch
unused merchant-group data.

Legacy runs without the version marker continue to use their original input
reader. A missing snapshot after a new run has advanced is an explicit error,
never a silent re-index or reset. The snapshot table is service-role-only.

New scheduled jobs use `optimization_version = 2` and continue in background
between cron ticks, avoiding the idle remainder of each ten-minute interval.
Legacy jobs are not upgraded in place. A manual priority request does not invoke
the daily producer, document synchronization or unrelated failed-cycle recovery.

## Release verification (2026-09-15)

- 49 targeted tests passed: OCT import/upsert/lineage, scheduling, DST boundaries,
  immutable run inputs, legacy compatibility and Workbench controls.
- Isolated PostgreSQL fixture, rolled back: manual priority, repeated enqueue,
  active legacy lease protection, concurrent claims, central OCT ownership,
  unchanged legacy checkpoint and spring/autumn DST boundaries.
- Broad Mexal suite: 183/196 passed; the same 13 failures reproduce on the
  previously published baseline (baseline also had one stale Planning assertion,
  now aligned with the existing window-opening behavior).
- Production build and targeted lint passed. The broader lint has pre-existing
  findings in stock sync and the automation settings component.
- Local browser rendering verified with simulated queued, running, completed
  and failed states, and the compact Anticipa produzione link.

Do not reset or cancel existing jobs to activate this release. Measure actual
runtime on the next complete new cycle; no unmeasured speedup is guaranteed.
