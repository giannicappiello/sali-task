import test from "node:test";
import assert from "node:assert/strict";
import { confirmWorkspaceV4 } from "./workspacemes-v4-api.js";

function fixture() {
  const tables = {
    workspace_v4_previews: [{ id: 1, production_request_id: 2, status: "READY", preview_hash: "hash", external_id: "preview", local_row_version: 1, snapshot: { demands: [{ workspaceLineId: "line" }] } }],
    workspace_production_requests: [{ id: 2, external_id: "request", rdp_number: 167, workspace_status: "READY" }],
    workspace_v4_preview_materials: [], workspace_rdp_cancellations: [], workspace_v4_confirmation_mirrors: [],
  };
  const admin = {
    from(name) {
      let update, filters = [];
      const query = { select() { return this; }, limit() { return this; },
        eq(k,v) { filters.push(row => row[k] === v); return this; },
        neq(k,v) { filters.push(row => row[k] !== v); return this; },
        is(k) { assert.equal(k, "snapshot->confirmationRecovery"); filters.push(row => !row.snapshot?.confirmationRecovery); return this; },
        update(value) { update = value; return this; },
        then(resolve) { const rows = tables[name].filter(row => filters.every(f => f(row))); if (update) rows.forEach(row => Object.assign(row, structuredClone(update))); return Promise.resolve({ data: structuredClone(rows) }).then(resolve); },
      }; return query;
    },
    async rpc(name, args) {
      const row = { status: "FORECAST", mes_response: args.p_mes_response, preview_id: 1 };
      tables.workspace_v4_confirmation_mirrors.push(row); tables.workspace_v4_previews[0].status = "CONFIRMED";
      return { data: [row] };
    },
  };
  return { admin, tables };
}
test("timeout e riapertura riutilizzano payload originale e restituiscono il mirror senza reinvio", async () => {
  const { admin, tables } = fixture(); let first, calls = 0;
  const response = { status: "FORECAST", productionCreated: false, productionOrders: [], forecastLines: ["line"] };
  const client = { v4ConfirmationEnabled: () => true, async confirmV4(id, command) {
    calls++;
    if (calls === 1) { first = structuredClone(command); throw Object.assign(new Error("timeout"), { name: "AbortError" }); }
    assert.deepEqual(command, first); return { result: response };
  } };
  await assert.rejects(confirmWorkspaceV4({ admin, client, previewId: 1, reason: "Original reason", requestedBy: "one" }), { code: "V4_CONFIRM_PENDING" });
  assert.ok(tables.workspace_v4_previews[0].snapshot.confirmationRecovery);
  const result = await confirmWorkspaceV4({ admin, client, previewId: 1, reason: "Other reason", requestedBy: "two" });
  assert.deepEqual(result.mes, response);
  assert.deepEqual((await confirmWorkspaceV4({ admin, client, previewId: 1, reason: "Other reason", requestedBy: "two" })).mes, response);
  assert.equal(calls, 2);
});

test("mirror non salvato: recupera la risposta persistita senza richiamare MES", async () => {
  const { admin } = fixture(); let calls = 0;
  const response = { status: "FORECAST", productionCreated: false, productionOrders: [], forecastLines: ["line"] };
  const client = { v4ConfirmationEnabled: () => true, async confirmV4() { calls++; return { result: response }; } };
  const rpc = admin.rpc;
  admin.rpc = async () => ({ error: { message: "temporarily unavailable", code: "DB_UNAVAILABLE" } });
  const args = { admin, client, previewId: 1, reason: "Original reason", requestedBy: "one" };
  await assert.rejects(confirmWorkspaceV4(args), { code: "V4_CONFIRM_PENDING" });
  admin.rpc = rpc;
  assert.deepEqual((await confirmWorkspaceV4(args)).mes, response);
  assert.equal(calls, 1);
});

test("conflitto storico preserva la richiesta per riconciliazione senza consentire un nuovo ricalcolo", async () => {
  const { admin, tables } = fixture();
  const client = { v4ConfirmationEnabled: () => true, async confirmV4() { throw Object.assign(new Error("Conflitto"), { code: "V4_IDEMPOTENCY_CONFLICT" }); } };
  await assert.rejects(confirmWorkspaceV4({ admin, client, previewId: 1, reason: "Original reason", requestedBy: "one" }), { code: "V4_IDEMPOTENCY_CONFLICT" });
  const recovery = tables.workspace_v4_previews[0].snapshot.confirmationRecovery;
  assert.equal(recovery.rejected, false);
  assert.equal(recovery.reconciliationRequired, true);
});
