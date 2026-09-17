import test from "node:test";
import assert from "node:assert/strict";
import { recoverStaleModule } from "../src/deployment-recovery.js";

test("stale deployment chunk reloads once and does not loop during an outage", () => {
  let value = null, reloads = 0, prevented = 0;
  const storage = { getItem: () => value, setItem: (_, next) => { value = next; } };
  const location = { reload: () => { reloads++; } };
  const event = { payload: new Error("Failed to fetch dynamically imported module: /assets/old.js"), preventDefault: () => { prevented++; } };
  assert.equal(recoverStaleModule(event, location, storage, 100000), true);
  assert.equal(recoverStaleModule(event, location, storage, 100100), false);
  assert.equal(reloads, 1);
  assert.equal(prevented, 1);
});

test("unrelated errors do not reload the current form", () => {
  assert.equal(recoverStaleModule({ payload: new Error("Validation failed") }, { reload: () => assert.fail() }, {}), false);
});
