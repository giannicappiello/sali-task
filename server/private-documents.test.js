import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPrivateDocumentToken } from "./private-documents.js";

test("il ticket Documenti Private è firmato, breve e contiene il perimetro cliente", () => {
  const secret = "workspace-private-documents-secret-123456789";
  const token = createPrivateDocumentToken({ subject: "utente-1", email: "utente@example.test",
    operations: ["view", "upload"], customerCodes: ["501.00001"], now: 1_800_000_000 }, secret);
  const [encoded, signature] = token.split(".");
  assert.equal(signature, createHmac("sha256", secret).update(encoded).digest("base64url"));
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.deepEqual(payload.customerCodes, ["501.00001"]);
  assert.deepEqual(payload.operations, ["view", "upload"]);
  assert.equal(payload.expiresAt - payload.issuedAt, 600);
});

test("la migrazione conserva in Workspace documenti e genealogia SL", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260831210000_workspace_private_documents_and_sl_genealogy.sql", import.meta.url), "utf8");
  assert.match(migration, /create table if not exists public\.workspace_private_documents/i);
  assert.match(migration, /create table if not exists public\.workspace_sl_genealogy/i);
  assert.match(migration, /documento_sl text/i);
  assert.match(migration, /lotto_origine text not null/i);
  assert.match(migration, /lotto_destinazione text not null/i);
});

test("Documenti Private apre la pagina Workspace e non il contenitore MES legacy", async () => {
  const [migration, app, authorization, layout, proxy] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260831224000_repoint_private_documents_module.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./private-documents.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/WorkspaceScreenLayout.jsx", import.meta.url), "utf8"),
    readFile(new URL("../api/private-documents.js", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /new\.percorso := '\/documentation\/private'/);
  assert.match(migration, /new\.tipo := 'modulo'/);
  assert.match(migration, /where modulo_codice = 'progremes_formule'/);
  assert.match(app, /moduleCode="progremes_formule"/);
  assert.match(authorization, /target_module: "progremes_formule"/);
  assert.match(layout, /"\/documentation\/private"/);
  assert.match(proxy, /bodyParser: false/);
  assert.match(proxy, /proxyPrivateDocuments/);
});
