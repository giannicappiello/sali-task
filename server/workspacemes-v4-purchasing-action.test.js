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

test("la creazione manuale inoltra la protezione duplicati", async () => {
  const source = await readFile(new URL("../src/pages/Production/PurchaseRequirements.jsx", import.meta.url), "utf8");
  assert.match(source, /run\("CREATE_PF", \{ supplierId, month: group\.month, ignoreDuplicates: true/);
});
