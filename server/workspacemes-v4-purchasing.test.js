import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AUTOMATIC_ARTICLE_SUPPLIER_SOURCE, attachWorkspaceArticleSuppliers, synchronizeWorkspaceArticleSupplierAssociations, validateWorkspaceV4PurchaseDocument, workspaceArticleSupplierHistoryNeedsRefresh } from "./workspacemes-v4-purchasing.js";

test("la catena acquisti V4 richiede fornitore, quantità e lineage", () => {
  const rfq = validateWorkspaceV4PurchaseDocument({ documentType: "RFQ", supplierExternalRef: "F001", lines: [{ requirementId: 1, quantity: 10 }] });
  assert.equal(rfq.documentType, "RFQ");
  assert.equal(rfq.parentDocumentId, null);
  assert.throws(() => validateWorkspaceV4PurchaseDocument({ documentType: "QUOTE", supplierExternalRef: "F001", lines: [{ requirementId: 1, quantity: 10 }] }), /padre/);
  assert.throws(() => validateWorkspaceV4PurchaseDocument({ documentType: "RFQ", supplierExternalRef: "", lines: [{ requirementId: 1, quantity: 10 }] }), /Fornitore/);
});

test("le associazioni Workspace sono applicate a tutte le righe dello stesso articolo", () => {
  const requirements = [{ key: "10:a", articleId: 10 }, { key: "10:b", articleId: 10 }, { key: "11:a", articleId: 11 }];
  const associations = [{ id: 5, article_id: 10, supplier_id: 7, supplier_code: "F7", supplier_name: "Fornitore 7" }];
  const enriched = attachWorkspaceArticleSuppliers(requirements, associations);
  assert.equal(enriched[0].workspaceSuppliers[0].associationId, 5);
  assert.equal(enriched[1].workspaceSuppliers[0].id, 7);
  assert.deepEqual(enriched[2].workspaceSuppliers, []);
});

test("la migration associazioni articolo-fornitore è additiva e riservata al service role", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260904170000_workspace_article_supplier_associations.sql", import.meta.url), "utf8");
  assert.match(migration, /unique \(article_id, supplier_id\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all .* anon, authenticated/i);
  assert.match(migration, /grant all .* service_role/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b|\bdrop\b|\btruncate\b/i);
});

test("le associazioni storiche vengono risolte automaticamente per codice e salvate in un solo upsert", async () => {
  let saved = [];
  const admin = { from: () => ({ upsert(rows) { saved = rows; return Promise.resolve({ error: null }); } }) };
  const result = await synchronizeWorkspaceArticleSupplierAssociations({
    admin,
    relationships: [
      { articleCode: " mp01 ", supplierCode: " f001 ", orderCount: 3, lastOrderAt: "2026-08-20" },
      { articleCode: "SCONOSCIUTO", supplierCode: "F001", orderCount: 1 },
    ],
    articles: [{ id: 11, codice: "MP01", codiceMexal: "MP01" }],
    suppliers: [{ id: 7, codiceMexal: "F001", ragioneSociale: "Fornitore Uno" }],
  });
  assert.equal(result.matched, 1);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], { article_id: 11, article_code: "MP01", supplier_id: 7,
    supplier_code: "F001", supplier_name: "Fornitore Uno", source: AUTOMATIC_ARTICLE_SUPPLIER_SOURCE,
    last_order_at: "2026-08-20", order_count: 3, source_seen_at: saved[0].source_seen_at,
    updated_at: saved[0].updated_at });
});

test("lo storico automatico viene riletto quando assente o scaduto", async () => {
  const query = (row) => ({ select() { return this; }, eq() { return this; }, maybeSingle() { return Promise.resolve({ data: row, error: null }); } });
  assert.equal(await workspaceArticleSupplierHistoryNeedsRefresh({ admin: { from: () => query(null) }, now: new Date("2026-09-04T12:00:00Z") }), true);
  assert.equal(await workspaceArticleSupplierHistoryNeedsRefresh({ admin: { from: () => query({ last_completed_at: "2026-09-04T06:00:00Z" }) }, now: new Date("2026-09-04T12:00:00Z") }), false);
  assert.equal(await workspaceArticleSupplierHistoryNeedsRefresh({ admin: { from: () => query({ last_completed_at: "2026-09-03T12:00:00Z" }) }, now: new Date("2026-09-04T12:00:00Z") }), true);
});

test("la migration automatica è additiva e non altera ordini o PF", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260904190000_automatic_article_supplier_associations.sql", import.meta.url), "utf8");
  assert.match(migration, /source text not null default 'MANUAL'/i);
  assert.match(migration, /workspace_article_supplier_sync_state/i);
  assert.match(migration, /enable row level security/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b|\bdrop\b|\btruncate\b/i);
});
