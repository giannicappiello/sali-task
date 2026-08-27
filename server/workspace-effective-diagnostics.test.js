import assert from "node:assert/strict";
import test from "node:test";

import { effectiveDiagnosticsHealth, effectiveWorkspaceDiagnostics } from "./workspace-effective-diagnostics.js";

const RDP_ID = "00000000-0000-4000-8000-000000000101";
const RDP_EXTERNAL_ID = "00000000-0000-4000-8000-000000000102";
const RETIRED_LINE_ID = "00000000-0000-4000-8000-000000000201";
const ACTIVE_LINE_ID = "00000000-0000-4000-8000-000000000202";
const UNLINKED_LINE_ID = "00000000-0000-4000-8000-000000000203";

function adminDouble() {
  const tables = {
    workspace_production_requests: [{ id: RDP_ID, external_id: RDP_EXTERNAL_ID, workspace_status: "Cancelled" }],
    ordini_righe: [
      { id: RETIRED_LINE_ID, mexal_attiva: false },
      { id: ACTIVE_LINE_ID, mexal_attiva: true },
      { id: UNLINKED_LINE_ID, mexal_attiva: true },
    ],
    workspace_production_request_items: [{ production_request_id: RDP_ID, ordine_riga_id: ACTIVE_LINE_ID }],
  };
  return {
    from(table) {
      let rows = tables[table] || [];
      const query = {
        select() { return query; },
        in(column, values) {
          rows = rows.filter((row) => values.includes(String(row[column])));
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return query;
    },
  };
}

function diagnostic(overrides = {}) {
  return {
    diagnosticId: "diagnostic-1", severity: "Blocking", status: "Open",
    entityType: "OCT_LINE", entityId: ACTIVE_LINE_ID,
    workspaceRdpV2Id: null, workspaceOctLineRevisionId: ACTIVE_LINE_ID,
    actionRequired: "Correggere la distinta", ...overrides,
  };
}

test("una diagnostica di RdP annullata resta auditabile ma diventa storica", async () => {
  const [row] = await effectiveWorkspaceDiagnostics({
    admin: adminDouble(),
    diagnostics: [diagnostic({ workspaceRdpV2Id: RDP_EXTERNAL_ID })],
  });
  assert.equal(row.originalStatus, "Open");
  assert.equal(row.status, "Resolved");
  assert.equal(row.workspaceDisposition, "Historical");
  assert.match(row.actionRequired, /nessuna azione operativa/i);
});

test("righe ritirate o appartenenti solo a RdP annullate sono storiche, una riga corrente resta blocking", async () => {
  const rows = await effectiveWorkspaceDiagnostics({
    admin: adminDouble(),
    diagnostics: [
      diagnostic({ diagnosticId: "retired", entityId: RETIRED_LINE_ID, workspaceOctLineRevisionId: RETIRED_LINE_ID }),
      diagnostic({ diagnosticId: "cancelled-line" }),
      diagnostic({ diagnosticId: "active", entityId: UNLINKED_LINE_ID, workspaceOctLineRevisionId: UNLINKED_LINE_ID }),
    ],
  });
  assert.equal(rows[0].workspaceDisposition, "Historical");
  assert.equal(rows[1].workspaceDisposition, "Historical");
  assert.equal(rows[2].status, "Open");
  assert.equal("workspaceDisposition" in rows[2], false);
});

test("health esclude lo storico ma conserva l'outbox pendente come warning", () => {
  const health = effectiveDiagnosticsHealth({
    database: true, workspaceCallbacks: true, pendingOutbox: 1,
    lastMexalSuccess: "2026-08-27T08:00:00Z", lastMexalError: null,
  }, [diagnostic({ status: "Resolved", workspaceDisposition: "Historical" })]);
  assert.equal(health.blocking, 0);
  assert.equal(health.open, 0);
  assert.equal(health.globalStatus, "YELLOW");
  assert.equal(health.pendingOutbox, 1);
});
