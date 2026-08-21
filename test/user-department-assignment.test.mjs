import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const settings = await readFile("src/pages/Settings/Settings.jsx", "utf8");

test("saving user access also clears or replaces the legacy primary department", () => {
  assert.match(
    settings,
    /const selectedDepartmentIds = \[[\s\S]*new Set\(\(userAccessForm\.reparti \|\| \[\]\)\.filter\(Boolean\)\)/,
  );
  assert.match(settings, /reparto_id: selectedDepartmentIds\[0\] \|\| null/);
  assert.match(settings, /const rows = selectedDepartmentIds\.map/);
});

test("saving user access permits removing the role", () => {
  assert.match(settings, /ruolo_id: userAccessForm\.ruolo_id \|\| null/);
});
