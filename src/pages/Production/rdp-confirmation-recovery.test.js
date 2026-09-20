import test from "node:test";
import assert from "node:assert/strict";
import { recoverConfirmation } from "./rdp-confirmation-recovery.js";

test("recupera un esito tardivo senza cambiare richiesta", async () => {
  let calls = 0, pending = 0;
  const result = { mes: { status: "FORECAST" } };
  assert.equal(await recoverConfirmation(async () => {
    calls++;
    if (calls < 3) throw Object.assign(new Error("timeout"), { code: "V4_CONFIRM_PENDING" });
    return result;
  }, { wait: async () => {}, onPending: () => pending++ }), result);
  assert.equal(calls, 3); assert.equal(pending, 2);
});
test("non ripete errori di validazione", async () => {
  let calls = 0;
  await assert.rejects(recoverConfirmation(async () => {
    calls++; throw Object.assign(new Error("stale"), { code: "V4_PREVIEW_STALE" });
  }), { code: "V4_PREVIEW_STALE" });
  assert.equal(calls, 1);
});
test("un'interruzione di rete persistente resta un esito incerto", async () => {
  let calls = 0;
  await assert.rejects(recoverConfirmation(async () => { calls++; throw new TypeError("fetch failed"); },
    { wait: async () => {}, attempts: 3 }), { code: "V4_CONFIRM_PENDING" });
  assert.equal(calls, 3);
});
