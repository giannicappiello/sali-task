import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeOct } from "./sync-oct-orders.js";

const oct2412 = JSON.parse(fs.readFileSync(
  new URL("./fixtures/oct-2-412.parallel.json", import.meta.url),
  "utf8",
));
const migration = fs.readFileSync(
  new URL("../../supabase/migrations/20260823080000_phase1c0_nullable_descriptive_order_lines.sql", import.meta.url),
  "utf8",
);

function satisfiesArticleCodeConstraint(line) {
  return line.riga_descrittiva === true || line.codice_articolo !== null;
}

test("migration rende nullable codice_articolo senza introdurre automazioni", () => {
  assert.match(migration, /alter column codice_articolo drop not null/i);
  assert.match(migration, /check\s*\(riga_descrittiva or codice_articolo is not null\)/i);
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?(?:trigger|function)/i);
});

test("riga articolo richiede codice mentre riga descrittiva accetta null", () => {
  assert.equal(satisfiesArticleCodeConstraint({ riga_descrittiva: false, codice_articolo: "PB0004" }), true);
  assert.equal(satisfiesArticleCodeConstraint({ riga_descrittiva: false, codice_articolo: null }), false);
  assert.equal(satisfiesArticleCodeConstraint({ riga_descrittiva: true, codice_articolo: null }), true);
});

test("OCT 2/412 produce una riga articolo e due descrittive compatibili con lo schema", () => {
  const normalized = normalizeOct(oct2412);
  const articleLines = normalized.lines.filter((line) => !line.riga_descrittiva);
  const descriptiveLines = normalized.lines.filter((line) => line.riga_descrittiva);

  assert.equal(normalized.lines.length, 3);
  assert.equal(articleLines.length, 1);
  assert.equal(articleLines[0].codice_articolo, "PB0004");
  assert.equal(descriptiveLines.length, 2);
  assert.deepEqual(descriptiveLines.map((line) => line.codice_articolo), [null, null]);
  assert.equal(normalized.lines.every(satisfiesArticleCodeConstraint), true);
});
