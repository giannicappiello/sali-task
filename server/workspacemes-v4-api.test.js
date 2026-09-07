import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { automaticWorkspaceV4Decision } from "./workspacemes-v4-api.js";

test("API V4 non legge distinte, giacenze o impegni Workspace", async () => {
  const source = await readFile(new URL("./workspacemes-v4-api.js", import.meta.url), "utf8");
  for (const forbidden of ["workspace_finished_bom", "ordini_prodotti_cache", "workspace_v3_material_commitments", "explodeFinishedBom", "netDirectComponent"])
    assert.doesNotMatch(source, new RegExp(forbidden, "i"));
  assert.match(source, /client\.previewV4\(command\)/);
  assert.match(source, /finishedArticleCode/);
  assert.match(source, /shortage_quantity/);
});

test("la decisione V4 è calcolata automaticamente dalle carenze certificate", () => {
  assert.equal(automaticWorkspaceV4Decision({ status: "READY" }, [{ shortage_quantity: 0 }]), "COMPLETE");
  assert.equal(automaticWorkspaceV4Decision({ status: "READY" }, [{ shortage_quantity: 12.5 }]), "WITH_SHORTAGES");
});

test("una preview bloccata non viene confusa con un semplice fabbisogno", () => {
  assert.throws(
    () => automaticWorkspaceV4Decision({ status: "BLOCKED" }, [{ shortage_quantity: 1, block_code: "FORMULA_MISSING" }]),
    (error) => error.code === "V4_PREVIEW_BLOCKED",
  );
  assert.throws(
    () => automaticWorkspaceV4Decision({ status: "READY" }, [{ shortage_quantity: 1, block_code: "MATERIAL_MAPPING_MISSING" }]),
    (error) => error.code === "V4_PREVIEW_BLOCKED",
  );
});

test("l'API V4 non accetta più una scelta manuale sui fabbisogni", async () => {
  const source = await readFile(new URL("./workspacemes-v4-api.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /INVALID_V4_DECISION|V4_SHORTAGE_DECISION_REQUIRED/);
  assert.match(source, /automaticWorkspaceV4Decision\(preview, materials\)/);
});

test("la conferma V4 trasferisce a ProgreMES il progressivo RdP Workspace", async () => {
  const source = await readFile(new URL("./workspacemes-v4-api.js", import.meta.url), "utf8");
  assert.match(source, /workspaceRdpNumber:\s*Number\(request\.rdp_number\)/);
  assert.match(source, /V4_RDP_NUMBER_REQUIRED/);
});
