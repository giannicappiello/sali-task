import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  checkpointSyncRunProgress,
  isResumableSyncRun,
  resumeFailedSync,
} from "../server/mexal/lib/syncRuns.js";
import {
  STOCK_RUN_STATE_VERSION,
  STOCK_RUN_STALE_MS,
  shouldReplayStockCheckpoint,
  stockBatchCheckpoint,
  stockRunState,
} from "../server/mexal/lib/stockRunState.js";

function runningRun(overrides = {}) {
  return {
    id: 435,
    sync_type: "stocks",
    status: "running",
    started_at: "2026-08-24T05:00:00.000Z",
    processed: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    metadata: {},
    ...overrides,
  };
}

function applyBatch(run, batch, options) {
  const checkpoint = stockBatchCheckpoint(run, batch, options);
  return { ...run, ...checkpoint.values };
}

let run = runningRun({
  id: 1,
  started_at: "2026-08-24T10:00:00.000Z",
  metadata: { stock_state_version: STOCK_RUN_STATE_VERSION, next_offset: 0, batch_size: 2 },
});
run = applyBatch(run, { processed: 2, updated: 2 }, { total: 5, batchSize: 2, now: "2026-08-24T10:01:00.000Z" });
assert.equal(stockRunState(run).nextOffset, 2, "il primo batch persiste il cursore lato server");

const interruptedState = stockRunState(run, { now: Date.parse("2026-08-24T10:02:00.000Z") });
assert.equal(interruptedState.processed, 2, "un'interruzione client non perde il progresso confermato");
assert.equal(shouldReplayStockCheckpoint({ requestedOffset: 0, resume: true, state: interruptedState }), false, "un nuovo client può riprendere dal checkpoint server");
assert.equal(shouldReplayStockCheckpoint({ requestedOffset: 0, resume: false, state: interruptedState }), true, "il retry della vecchia richiesta non avanza un secondo batch");

run = applyBatch(run, { processed: 2, updated: 1, skipped: 1 }, { total: 5, batchSize: 2, now: "2026-08-24T10:03:00.000Z" });
run = applyBatch(run, { processed: 1, updated: 1 }, { total: 5, batchSize: 2, now: "2026-08-24T10:04:00.000Z" });
const completedState = stockRunState(run);
assert.deepEqual(
  { processed: completedState.processed, updated: completedState.updated, skipped: completedState.skipped, failed: completedState.failed },
  { processed: 5, updated: 4, skipped: 1, failed: 0 },
  "la run normale arriva a completion con conteggi cumulativi, senza contare due volte i retry",
);

const stale = stockRunState(runningRun({ metadata: { checkpointed_at: "2026-08-24T05:10:00.000Z" } }), {
  now: Date.parse("2026-08-24T05:10:00.000Z") + STOCK_RUN_STALE_MS,
});
assert.equal(stale.stale, true, "una run abbandonata viene riconosciuta dal suo ultimo checkpoint");
assert.equal(stale.legacy, true, "la run 435 priva di checkpoint versione 2 è riconosciuta come legacy");
assert.equal(stale.nextOffset, 0, "una run legacy riparte prudentemente da zero, con upsert idempotenti");

function inMemoryAdmin(initialRun) {
  let row = structuredClone(initialRun);
  return {
    current: () => structuredClone(row),
    from(table) {
      assert.equal(table, "mexal_sync_runs");
      return {
        update(payload) {
          const filters = {};
          const chain = {
            eq(key, value) { filters[key] = value; return chain; },
            order() { return chain; },
            limit() { return chain; },
            select() { return chain; },
            async maybeSingle() {
              const matches = Object.entries(filters).every(([key, value]) => row[key] === value);
              if (!matches) return { data: null, error: null };
              row = { ...row, ...structuredClone(payload) };
              return { data: structuredClone(row), error: null };
            },
          };
          return chain;
        },
        select() {
          const filters = {};
          const chain = {
            eq(key, value) { filters[key] = value; return chain; },
            order() { return chain; },
            limit() { return chain; },
            async maybeSingle() {
              const matches = Object.entries(filters).every(([key, value]) => row[key] === value);
              return { data: matches ? structuredClone(row) : null, error: null };
            },
          };
          return chain;
        },
      };
    },
  };
}

const concurrentAdmin = inMemoryAdmin(runningRun({ id: 9, metadata: { stock_state_version: 2, next_offset: 0 } }));
const first = await checkpointSyncRunProgress(concurrentAdmin, 9, 0, { processed: 2, updated: 2, metadata: { stock_state_version: 2, next_offset: 2 } });
const retry = await checkpointSyncRunProgress(concurrentAdmin, 9, 0, { processed: 2, updated: 2, metadata: { stock_state_version: 2, next_offset: 2 } });
assert.equal(first.advanced, true);
assert.equal(retry.advanced, false, "due richieste concorrenti non possono confermare due volte lo stesso offset");
assert.equal(concurrentAdmin.current().updated, 2, "il retry dello stesso batch non duplica i conteggi logici");

const failed435 = runningRun({
  status: "failed",
  processed: 5016,
  updated: 3127,
  failed: 1,
  error_message: "upstream request timeout",
  metadata: {
    stock_state_version: STOCK_RUN_STATE_VERSION,
    next_offset: 5016,
    batch_size: 12,
    checkpointed_at: "2026-08-24T11:30:00.000Z",
  },
});
assert.equal(isResumableSyncRun(failed435), true, "la run 435 fallita per timeout è recuperabile");

const resumeAdmin = inMemoryAdmin(failed435);
const resumed435 = await resumeFailedSync(resumeAdmin, 435);
assert.equal(resumed435.id, 435, "il recovery riusa la stessa run senza crearne una nuova");
assert.equal(resumed435.status, "running");
assert.equal(resumed435.processed, 5016, "il recovery conserva l'ultimo checkpoint valido");
assert.equal(resumed435.updated, 3127, "i contatori confermati non vengono riprodotti");
assert.equal(resumed435.failed, 0, "l'indicatore del timeout terminale viene rimosso al resume");
assert.equal(stockRunState(resumed435).nextOffset, 5016);

const disconnectedState = structuredClone(resumeAdmin.current());
const nextSessionState = stockRunState(disconnectedState);
assert.equal(nextSessionState.nextOffset, 5016, "una nuova sessione client legge il cursore dal server");
assert.equal(shouldReplayStockCheckpoint({ requestedOffset: 0, resume: true, state: nextSessionState }), false);

const permanentFailure = { ...failed435, error_message: "articolo non valido", metadata: {} };
assert.equal(isResumableSyncRun(permanentFailure), false, "un errore permanente non viene riaperto automaticamente");
const explicitlyPermanentFailure = { ...failed435, metadata: { recovery: { retryable: false } } };
assert.equal(isResumableSyncRun(explicitlyPermanentFailure), false, "la classificazione persistita prevale sul testo dell'errore");

function readOnlyRowsAdmin(rows) {
  return {
    from(table) {
      assert.equal(table, "mexal_sync_runs");
      return {
        select() {
          const filters = {};
          const chain = {
            eq(key, value) { filters[key] = value; return chain; },
            order() { return chain; },
            limit() { return chain; },
            async maybeSingle() {
              const row = rows.find((candidate) => Object.entries(filters).every(([key, value]) => candidate[key] === value));
              return { data: row ? structuredClone(row) : null, error: null };
            },
          };
          return chain;
        },
        update() {
          throw new Error("il resume non deve aggiornare nulla quando esiste già una run attiva");
        },
      };
    },
  };
}

const activeRun = runningRun({ id: 999 });
await assert.rejects(
  resumeFailedSync(readOnlyRowsAdmin([failed435, activeRun]), 435),
  (error) => error.status === 409 && error.syncRunId === 999,
  "una run stocks concorrente blocca il recovery prima di qualsiasi modifica",
);

const handlerSource = await readFile("server/mexal/sync-products.js", "utf8");
const automationSource = await readFile("api/mexal/automation.js", "utf8");
const runsSource = await readFile("server/mexal/lib/syncRuns.js", "utf8");
assert.match(handlerSource, /checkpointSyncRunProgress\(supabase, syncRunId/);
assert.match(handlerSource, /result\.completato && persistedState\.failed > 0[\s\S]*failSyncRun\(supabase, syncRunId/, "gli errori reali chiudono la run in failed");
assert.match(handlerSource, /\.eq\("codice_mexal", code\)\.eq\("sincronizzato_mexal", true\)\.eq\("attivo_mexal", true\)/, "gli update restano idempotenti e limitati agli articoli ammessi");
assert.match(automationSource, /syncType === "stocks" && body\.resume === true/, "un nuovo client può collegarsi alla sola run stocks già attiva");
assert.match(automationSource, /resumeFailedSync\(admin\.supabase/, "una run stocks failed per timeout viene riaperta con lo stesso id");
assert.match(automationSource, /if \(running && !isContinuation\) return sendRunning/, "una seconda run concorrente resta bloccata");
assert.match(runsSource, /if \(syncType === "stocks"\) return/, "una run stocks stale resta riprendibile e continua a fungere da lock");

console.log("Mexal stocks resume, retry, stale detection and concurrency boundaries are enforced");
