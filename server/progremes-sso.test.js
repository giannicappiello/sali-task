import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { progremesContextualRoute, progremesDirectOperationalRoute } from "./progremes-sso-routes.js";

test("l'elenco OdP MES ha una sola destinazione operativa diretta consentita", () => {
  assert.equal(
    progremesDirectOperationalRoute("progremes.Ordini.Produzione"),
    "/ordini/produzione",
  );
  assert.equal(progremesDirectOperationalRoute("progremes.Ordini.Cliente"), "");
  assert.equal(progremesDirectOperationalRoute("https://example.invalid"), "");
});

test("il collegamento COA usa soltanto la destinazione Documenti autorizzata", () => {
  assert.equal(
    progremesContextualRoute("progremes.Documenti", { destination: "coa-produzioni", productionId: 42 }, "/documenti"),
    "/documenti/coa/compila/42",
  );
  assert.equal(
    progremesContextualRoute("progremes.Documenti", { destination: "coa-produzioni" }, "/documenti"),
    "/documenti/coa/compila",
  );
  assert.equal(
    progremesContextualRoute("progremes.Documenti", {
      destination: "coa-produzioni",
      article: "BT0001",
      lot: "400100035",
    }, "/documenti"),
    "/documenti/coa/compila?article=BT0001&lot=400100035",
  );
  assert.equal(
    progremesContextualRoute("progremes.Documenti", {
      destination: "coa-produzioni",
      article: "IT 0084/PROVA",
      lot: "Lotto 1+2",
    }, "/documenti"),
    "/documenti/coa/compila?article=IT+0084%2FPROVA&lot=Lotto+1%2B2",
  );
  assert.equal(
    progremesContextualRoute("progremes.Ordini", { destination: "coa-produzioni" }, "/gestione-ordini"),
    "/gestione-ordini",
  );
});

test("il fallback OdP mantiene il controllo autorizzativo SSO", async () => {
  const source = await readFile(new URL("./progremes-sso.js", import.meta.url), "utf8");
  assert.match(source, /if \(!identity\.isAdmin\) \{[\s\S]*isProgremesScreenAuthorized/);
  assert.match(source, /directOperationalRoute \|\| screen\.metadati\?\.external_route/);
});
