import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const documentationPage = await readFile(
  "src/pages/Documentation/Documentation.jsx",
  "utf8",
);
const gatewaySettings = await readFile(
  "src/modules/integrations/pages/DocumentGatewaySettings.jsx",
  "utf8",
);
const documentApi = await readFile("server/document-api.js", "utf8");

test("the document editor keeps an explicit product selection", () => {
  assert.match(documentationPage, /sameId\(item\.id, linkEditor\.prodotto_id\)/);
  assert.match(documentationPage, /<option value="">Nessun prodotto selezionato<\/option>/);
  assert.match(documentationPage, /prodotto_id: prodottoId/);
});

test("the integration editor initializes the linked product code", () => {
  assert.match(gatewaySettings, /linkedProduct\?\.codice_mexal/);
  assert.match(gatewaySettings, /sameId\(product\.id, document\.prodotto_id\)/);
});

test("the document API validates the selected product before saving", () => {
  assert.match(documentApi, /from\("prodotti"\)\.select\("id,nome"\)/);
  assert.match(documentApi, /Il prodotto selezionato non esiste/);
});

test("document cards expose association status and an unlinked filter", () => {
  assert.match(documentationPage, /hasDocumentAssociation/);
  assert.match(documentationPage, /Solo non associati/);
  assert.doesNotMatch(documentationPage, />Associato</);
  assert.doesNotMatch(documentationPage, />Non associato</);
  assert.match(documentationPage, /associated && \(/);
  assert.match(documentationPage, /associationValues\(document\.brand_prodotti\)/);
  assert.match(documentationPage, /associationValues\(document\.linee_prodotto\)/);
});
