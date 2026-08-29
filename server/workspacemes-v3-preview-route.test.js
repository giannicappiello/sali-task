import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("ricalcolo V3 aggiorna stato e rimuove il vecchio errore dalla RdP", async () => {
  const source = await readFile(new URL("../api/mexal/automation.js", import.meta.url), "utf8");
  const route = source.match(/case "workspacemes_v3_preview": \{([\s\S]*?)case "workspacemes_v3_confirm":/i)?.[1] || "";
  assert.match(route, /last_error_code:\s*null/);
  assert.match(route, /last_response:\s*\{ contractVersion: 3, previewId: v3Preview\.preview_id, status: v3Preview\.status \}/);
  assert.match(route, /last_error_code:\s*previewError\.code \|\| "V3_PREVIEW_FAILED"/);
});
