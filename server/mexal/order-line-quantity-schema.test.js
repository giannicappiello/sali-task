import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeOct } from "./sync-oct-orders.js";

const oct2412 = JSON.parse(fs.readFileSync(
  new URL("./fixtures/oct-2-412.parallel.json", import.meta.url),
  "utf8",
));
const migration = fs.readFileSync(
  new URL("../../supabase/migrations/20260823090000_phase1c0_allow_descriptive_zero_quantity.sql", import.meta.url),
  "utf8",
);

function satisfiesQuantityConstraint(line) {
  const quantity = Number(line.quantita);
  return line.riga_descrittiva ? quantity >= 0 : quantity > 0;
}

test("migration sostituisce soltanto il check quantità con la regola condizionale", () => {
  assert.match(migration, /drop constraint if exists ordini_righe_quantita_check/i);
  assert.match(migration, /not riga_descrittiva and quantita > 0/i);
  assert.match(migration, /riga_descrittiva and quantita >= 0/i);
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?(?:trigger|function)/i);
});

test("riga articolo con quantità positiva supera il vincolo", () => {
  assert.equal(satisfiesQuantityConstraint({ riga_descrittiva: false, quantita: 1 }), true);
});

test("riga articolo con quantità zero non supera il vincolo", () => {
  assert.equal(satisfiesQuantityConstraint({ riga_descrittiva: false, quantita: 0 }), false);
});

test("riga descrittiva con quantità zero supera il vincolo", () => {
  assert.equal(satisfiesQuantityConstraint({ riga_descrittiva: true, quantita: 0 }), true);
});

test("OCT 2/412 conserva un articolo positivo e due descrittive a quantità zero", () => {
  const normalized = normalizeOct(oct2412);
  const articleLines = normalized.lines.filter((line) => !line.riga_descrittiva);
  const descriptiveLines = normalized.lines.filter((line) => line.riga_descrittiva);

  assert.equal(normalized.lines.length, 3);
  assert.equal(articleLines.length, 1);
  assert.ok(articleLines[0].quantita > 0);
  assert.equal(descriptiveLines.length, 2);
  assert.deepEqual(descriptiveLines.map((line) => line.quantita), [0, 0]);
  assert.equal(normalized.lines.every(satisfiesQuantityConstraint), true);
});
