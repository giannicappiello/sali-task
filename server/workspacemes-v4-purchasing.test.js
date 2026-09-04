import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { attachWorkspaceArticleSuppliers, validateWorkspaceV4PurchaseDocument } from "./workspacemes-v4-purchasing.js";

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
