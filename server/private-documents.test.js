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
