import test from "node:test";
import assert from "node:assert/strict";
import { recoverConfirmation } from "./rdp-confirmation-recovery.js";

test("una richiesta che non risponde termina come esito incerto e viene annullata", async () => {
  const signals = [];
  await assert.rejects(recoverConfirmation(({ signal }) => {
    signals.push(signal);
    return new Promise(() => {});
  }, { attemptTimeoutMs: 10, totalTimeoutMs: 500, attempts: 2, wait: async () => {} }),
  { code: "V4_CONFIRM_PENDING" });
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal.aborted));
});

test("il limite totale interrompe il recupero prima di esaurire i tentativi", async () => {
  let calls = 0;
  await assert.rejects(recoverConfirmation(() => {
    calls++;
    return new Promise(() => {});
  }, { attemptTimeoutMs: 1000, totalTimeoutMs: 20, attempts: 6, wait: async () => {} }),
  { code: "V4_CONFIRM_PENDING" });
  assert.equal(calls, 1);
});

test("piano occupato conserva la causa e permette il recupero della stessa richiesta", async () => {
  let calls = 0;
  const progress = [];
  await assert.rejects(recoverConfirmation(async () => {
    calls++;
    throw Object.assign(new Error("Il MES sta aggiornando il piano"), { code: "V4_PLANNING_BUSY" });
  }, { attempts: 2, wait: async () => {}, onPending: update => progress.push(update) }), error => {
    assert.equal(error.code, "V4_CONFIRM_PENDING");
    assert.match(error.message, /MES sta aggiornando il piano/);
    assert.match(error.message, /Recupera conferma/);
    return true;
  });
  assert.equal(calls, 2);
  assert.equal(progress[0].attempt, 1);
  assert.equal(progress[1].attempt, 2);
});

test("una risposta tardiva al primo tentativo non sostituisce la risposta recuperata", async () => {
  let late, calls = 0;
  const expected = { mes: { status: "FORECAST" } };
  assert.equal(await recoverConfirmation(() => {
    calls++;
    return calls === 1 ? new Promise(resolve => { late = resolve; }) : Promise.resolve(expected);
  }, { attempts: 2, attemptTimeoutMs: 10, wait: async () => {} }), expected);
  late({ mes: { status: "old response" } });
  assert.equal(calls, 2);
});
