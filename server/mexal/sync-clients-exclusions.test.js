import assert from "node:assert/strict";
import test from "node:test";
import { filterExcludedClients } from "./customer-exclusions.js";

test("la sincronizzazione ignora solo i codici nella lista permanente di esclusione", () => {
  const clients = [
    { codice_cliente: "501.00001", ragione_sociale: "Storico" },
    { codice_cliente: "501.99998", ragione_sociale: "Nuovo cliente" },
  ];

  assert.deepEqual(
    filterExcludedClients(clients, new Set(["501.00001"])),
    [{ codice_cliente: "501.99998", ragione_sociale: "Nuovo cliente" }],
  );
});

test("un nuovo codice Mexal non presente nella lista viene importato", () => {
  const futureClient = { codice_cliente: "501.99999", ragione_sociale: "Cliente futuro" };
  assert.deepEqual(filterExcludedClients([futureClient], new Set(["501.00001"])), [futureClient]);
});
