import assert from "node:assert/strict";
import test from "node:test";

import { normalizeItalianVisitDate } from "../src/modules/pharmacy/services/beautyVisitDate.js";

test("normalizza la data visita con anno a quattro cifre", () => {
  assert.equal(normalizeItalianVisitDate("07/09/2026"), "2026-09-07");
});

test("normalizza la data visita con anno a due cifre", () => {
  assert.equal(normalizeItalianVisitDate("7/9/26"), "2026-09-07");
});

test("rifiuta date inesistenti e formati con orario", () => {
  assert.equal(normalizeItalianVisitDate("31/02/2026"), null);
  assert.equal(normalizeItalianVisitDate("2026-09-07T10:30"), null);
});
