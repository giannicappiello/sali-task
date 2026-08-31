import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { progremesDirectOperationalRoute } from "./progremes-sso-routes.js";

test("l'elenco OdP MES ha una sola destinazione operativa diretta consentita", () => {
  assert.equal(
    progremesDirectOperationalRoute("progremes.Ordini.Produzione"),
    "/ordini/produzione",
  );
  assert.equal(progremesDirectOperationalRoute("progremes.Ordini.Cliente"), "");
  assert.equal(progremesDirectOperationalRoute("https://example.invalid"), "");
});

test("il fallback OdP mantiene il controllo autorizzativo SSO", async () => {
  const source = await readFile(new URL("./progremes-sso.js", import.meta.url), "utf8");
  assert.match(source, /if \(!identity\.isAdmin\) \{[\s\S]*isProgremesScreenAuthorized/);
  assert.match(source, /directOperationalRoute \|\| screen\.metadati\?\.external_route/);
});
