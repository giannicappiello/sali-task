import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("l'azione PF automatica è server-side, limitata a 60 giorni e idempotente", async () => {
  const source = await readFile(new URL("../api/mexal/automation.js", import.meta.url), "utf8");
  assert.match(source, /action === "GENERATE_PF_AUTOMATIC"/);
  assert.match(source, /const horizonDays = 60/);
  assert.match(source, /const selectedKeys = Array\.isArray\(body\.selectedKeys\)/);
  assert.match(source, /requirements\.filter\(\(row\) => selectedKeys\.has\(String\(row\.key\)\)\)/);
  assert.match(source, /automaticPfLines\(selectedRequirements, \{ generatedAt, horizonDays \}\)/);
  assert.match(source, /action, generatedAt, horizonDays, lines, ignoreDuplicates: true/);
});

test("la conferma inoltra i documenti del piano con protezione duplicati", async () => {
  const source = await readFile(new URL("../api/mexal/automation.js", import.meta.url), "utf8");
  assert.match(source, /action: "CREATE_PF", supplierId: item\.supplierId/);
  assert.match(source, /ignoreDuplicates: true/);
});

test("anteprima e conferma PF usano un piano con checksum prima della scrittura", async () => {
  const source = await readFile(new URL("../api/mexal/automation.js", import.meta.url), "utf8");
  assert.match(source, /action === "PREVIEW_PF" \|\| action === "CONFIRM_PF_PREVIEW"/);
  assert.match(source, /workspaceV4PfPlanChecksum\(plan\)/);
  assert.match(source, /I fabbisogni sono cambiati dopo l'anteprima/);
  assert.match(source, /action: "CREATE_PF"/);
});
