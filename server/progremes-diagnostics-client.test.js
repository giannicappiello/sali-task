import test from "node:test";
import assert from "node:assert/strict";
import { createProgremesDiagnosticManager, validateDiagnosticAction } from "./progremes-diagnostics-client.js";

const ID = "00000000-0000-4000-8000-000000000001";

test("diagnostic management accepts only the explicit safe action contract", () => {
  assert.equal(validateDiagnosticAction({ diagnosticId: ID, action: "resolve" }).action, "resolve");
  assert.throws(() => validateDiagnosticAction({ diagnosticId: ID, action: "delete" }), /non consentita/);
  assert.throws(() => validateDiagnosticAction({ diagnosticId: ID, action: "archive" }), /obbligatoria/);
});

test("diagnostic manager posts a bounded audited action to the v2 endpoint", async () => {
  let captured;
  const manager = createProgremesDiagnosticManager({
    progremesUrl: "https://mes.example.test", secret: "secret",
    fetchFn: async (url, options) => {
      captured = { url: String(url), options };
      return { ok: true, json: async () => ({ diagnosticId: ID, status: "Archived" }) };
    },
  });
  const result = await manager.changeStatus({ diagnosticId: ID, action: "archive", actor: "workspace:user", reason: "duplicato storico" });
  assert.equal(result.status, "Archived");
  assert.equal(new URL(captured.url).pathname, `/api/workspace/v2/diagnostics/${ID}/status`);
  assert.match(captured.options.headers["x-workspace-signature"], /^[a-f0-9]{64}$/);
  assert.ok(captured.options.headers["x-workspace-timestamp"]);
  assert.ok(captured.options.headers["x-workspace-event-id"]);
  assert.deepEqual(JSON.parse(captured.options.body), { action: "archive", actor: "workspace:user", reason: "duplicato storico" });
});
