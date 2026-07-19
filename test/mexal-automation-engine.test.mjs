import test from "node:test";
import assert from "node:assert/strict";
import { executeActionChain, nextRunAt } from "../api/mexal/lib/automationEngine.js";

test("calcola frequenze senza intervalli inferiori a 15 minuti", () => {
  assert.equal(nextRunAt("manual"), null);
  assert.equal(new Date(nextRunAt("every_15_minutes", new Date("2026-01-01T00:00:00Z"))).getTime(), Date.parse("2026-01-01T00:15:00Z"));
});
test("la catena rispetta l'ordine e si ferma su errore bloccante", async () => {
  const done = []; const result = await executeActionChain({ actions: [{ type: "one" }, { type: "two" }, { type: "three" }], executeAction: async (action) => { done.push(action.type); return action.type === "two" ? { status: "failed", error: "stop" } : { status: "completed" }; } });
  assert.deepEqual(done, ["one", "two"]); assert.equal(result.status, "failed");
});
test("un errore non bloccante permette la fase seguente", async () => {
  const done = []; const result = await executeActionChain({ actions: [{ type: "one", blocking: false }, { type: "two" }], executeAction: async (action) => { done.push(action.type); return action.type === "one" ? { status: "failed" } : { status: "completed" }; } });
  assert.equal(result.status, "completed"); assert.deepEqual(done, ["one", "two"]);
});
