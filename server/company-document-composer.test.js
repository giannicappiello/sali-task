import test from "node:test";
import assert from "node:assert/strict";
import { letterheadResolutionError } from "./company-document-composer.js";

test("mantiene il codice LETTERHEAD_NOT_CONFIGURED per attivare il PDF standard", () => {
  const mapped = letterheadResolutionError({
    code: "P0001",
    message: "LETTERHEAD_NOT_CONFIGURED: nessuna regola valida",
  });
  assert.equal(mapped.status, 409);
  assert.equal(mapped.code, "LETTERHEAD_NOT_CONFIGURED");
});

test("classifica separatamente gli altri errori di risoluzione intestazione", () => {
  const mapped = letterheadResolutionError({ code: "XX000", message: "Errore database" });
  assert.equal(mapped.status, 500);
  assert.equal(mapped.code, "LETTERHEAD_RESOLUTION_FAILED");
});
