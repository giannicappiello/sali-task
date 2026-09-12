import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorkspaceLayout } from "../src/components/workspaceScreenLayoutConfig.js";

test("workspace layout keeps safe presentation overrides", () => {
  const layout = normalizeWorkspaceLayout({
    version: 1,
    presentation: { title: "  Titolo configurato  ", description: "Descrizione configurata", ignored: "no" },
    blocks: [{ id: "content", type: "system-content", width: "full" }],
  });
  assert.deepEqual(layout.presentation, { title: "Titolo configurato", description: "Descrizione configurata" });
  assert.equal(layout.blocks[0].type, "system-content");
});

test("workspace layout does not inherit unknown presentation properties", () => {
  const layout = normalizeWorkspaceLayout({ presentation: { title: 42, hidden: true }, blocks: [] });
  assert.deepEqual(layout.presentation, {});
  assert.equal(layout.blocks.at(-1).type, "system-content");
});
