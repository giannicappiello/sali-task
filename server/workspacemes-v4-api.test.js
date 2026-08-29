import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("API V4 non legge distinte, giacenze o impegni Workspace", async () => {
  const source = await readFile(new URL("./workspacemes-v4-api.js", import.meta.url), "utf8");
  for (const forbidden of ["workspace_finished_bom", "ordini_prodotti_cache", "workspace_v3_material_commitments", "explodeFinishedBom", "netDirectComponent"])
    assert.doesNotMatch(source, new RegExp(forbidden, "i"));
  assert.match(source, /client\.previewV4\(command\)/);
  assert.match(source, /finishedArticleCode/);
  assert.match(source, /shortage_quantity/);
});
