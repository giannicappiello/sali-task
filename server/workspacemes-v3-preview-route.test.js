import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("ricalcolo V4 aggiorna stato e rimuove il vecchio errore dalla RdP", async () => {
  const source = await readFile(new URL("../api/mexal/automation.js", import.meta.url), "utf8");
  const route = source.match(/case "workspacemes_v4_preview": \{([\s\S]*?)case "workspacemes_v4_confirm":/i)?.[1] || "";
  assert.match(route, /last_error_code:\s*null/);
  assert.match(route, /last_response:\s*\{ contractVersion: 4, previewId: v4Preview\.id, status: v4Preview\.status \}/);
  assert.match(route, /last_error_code:\s*previewError\.code \|\| "V4_PREVIEW_FAILED"/);
});
