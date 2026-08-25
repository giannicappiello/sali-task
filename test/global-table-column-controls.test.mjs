import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compareTableValues,
  normalizeTableText,
  stableSortTableRows,
  tableValueMatches,
} from "../src/components/tableColumnControls.js";

test("il filtro delle colonne ignora maiuscole e accenti", () => {
  assert.equal(normalizeTableText("  Città   ATTIVA "), "citta attiva");
  assert.equal(tableValueMatches("Farmacìa Centrale", "farmacia"), true);
  assert.equal(tableValueMatches("Cliente non attivo", "attivo"), true);
  assert.equal(tableValueMatches("Conto terzi", "online"), false);
});

test("l'ordinamento riconosce numeri, importi e date italiane", () => {
  assert.ok(compareTableValues("€ 1.250,50", "€ 999,00") > 0);
  assert.ok(compareTableValues("02/09/2026", "25/08/2026") > 0);
  assert.ok(compareTableValues("9", "10") < 0);
  assert.ok(compareTableValues("—", "Azienda") > 0);
});

test("l'ordinamento crescente e decrescente resta stabile", () => {
  const rows = [
    { id: "a", value: "10" },
    { id: "b", value: "2" },
    { id: "c", value: "2" },
  ];

  assert.deepEqual(
    stableSortTableRows(rows, (row) => row.value, "asc").map((row) => row.id),
    ["b", "c", "a"],
  );
  assert.deepEqual(
    stableSortTableRows(rows, (row) => row.value, "desc").map((row) => row.id),
    ["a", "b", "c"],
  );
});

test("i controlli sono montati globalmente e coprono ogni tabella nativa", async () => {
  const [appSource, controlsSource] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/GlobalTableColumnControls.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /<GlobalTableColumnControls\s*\/>/);
  assert.match(controlsSource, /document\.querySelectorAll\("table"\)/);
  assert.match(controlsSource, /node\.querySelectorAll\("table"\)/);
});

