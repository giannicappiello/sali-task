import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("l'anteprima PF riusa il generatore PDF degli ordini PR", async () => {
  const source = await readFile(new URL("./pfPreviewPdf.js", import.meta.url), "utf8");
  assert.match(source, /import \{ createOrderPdf \} from "\.\/orderPdf\.js"/);
  assert.match(source, /type: "PF", serie: 1, numero: "ANTEPRIMA"/);
  assert.match(source, /party_kind: "supplier"/);
});
