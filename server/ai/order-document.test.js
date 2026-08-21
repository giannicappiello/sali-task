import test from "node:test";
import assert from "node:assert/strict";
import { rankCustomerCandidates, rankProductCandidates } from "./order-document.js";

test("abbina il cliente prima per partita IVA e poi per nome", () => {
  const rows = rankCustomerCandidates({ name: "Cliente sbagliato", vatNumber: "IT 01234567890" }, [
    { codice_cliente: "C001", ragione_sociale: "Cliente Corretto SRL", partita_iva: "01234567890", localita: "Roma" },
    { codice_cliente: "C002", ragione_sociale: "Cliente Sbagliato SPA", partita_iva: "99999999999", localita: "Milano" },
  ]);
  assert.equal(rows[0].code, "C001");
  assert.equal(rows[0].score, 0.99);
});

test("abbina il prodotto per codice anche con separatori diversi", () => {
  const rows = rankProductCandidates({ productCode: "AB-123", description: "descrizione non affidabile" }, [
    { codice_articolo: "AB 123", descrizione: "Prodotto corretto", ean: "" },
    { codice_articolo: "ZZ999", descrizione: "Descrizione non affidabile", ean: "" },
  ]);
  assert.equal(rows[0].code, "AB 123");
  assert.equal(rows[0].score, 1);
});

test("cerca il prodotto per codice, descrizione ed EAN anche nel testo fotografato", () => {
  const products = [
    { codice_articolo: "IT0055", descrizione: "CrioGel Gambe Stanche 500ml", ean: "8052049123456" },
    { codice_articolo: "IT0083", descrizione: "Bagno Doccia Mediterranean Sea", ean: "8052049654321" },
  ];

  assert.equal(rankProductCandidates({ sourceText: "2 x IT0055" }, products)[0].code, "IT0055");
  assert.equal(rankProductCandidates({ description: "CrioGel Gambe Stanche 500 ml" }, products)[0].code, "IT0055");
  assert.equal(rankProductCandidates({ sourceText: "EAN 8052049123456 quantità 2" }, products)[0].code, "IT0055");
});
