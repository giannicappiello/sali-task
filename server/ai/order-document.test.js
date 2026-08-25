import test from "node:test";
import assert from "node:assert/strict";
import { matchCustomer, matchProduct, rankCustomerCandidates, rankProductCandidates } from "../../shared/orderDocumentMatching.js";

test("abbina il cliente prima per partita IVA e poi per nome", () => {
  const rows = rankCustomerCandidates({ name: "Cliente sbagliato", vatNumber: "IT 01234567890" }, [
    { codice_cliente: "C001", ragione_sociale: "Cliente Corretto SRL", partita_iva: "01234567890", localita: "Roma" },
    { codice_cliente: "C002", ragione_sociale: "Cliente Sbagliato SPA", partita_iva: "99999999999", localita: "Milano" },
  ]);
  assert.equal(rows[0].code, "C001");
  assert.equal(rows[0].score, 0.99);
});

test("abbina il prodotto per codice anche con separatori diversi", () => {
  const rows = rankProductCandidates({ productCode: "IT-123", description: "descrizione non affidabile" }, [
    { codice_articolo: "IT 123", descrizione: "Prodotto corretto", ean: "" },
    { codice_articolo: "ZZ999", descrizione: "Descrizione non affidabile", ean: "" },
  ]);
  assert.equal(rows[0].code, "IT 123");
  assert.equal(rows[0].score, 1);
});

test("classifica cliente certo, ambiguo e non trovato senza auto-creazione", () => {
  const customers = [
    { codice_cliente: "C001", ragione_sociale: "Alfa S.R.L.", partita_iva: "01234567890", localita: "Roma" },
    { codice_cliente: "C002", ragione_sociale: "Alfa S.p.A.", partita_iva: "99999999999", localita: "Roma" },
  ];
  assert.equal(matchCustomer({ vatNumber: "IT01234567890", name: "Alfa" }, customers).match.status, "matched");
  assert.equal(matchCustomer({ name: "Alfa" }, customers).match.status, "ambiguous");
  assert.equal(matchCustomer({ email: "ordini@alfa.it" }, [{ ...customers[0], email: "ordini@alfa.it" }]).match.status, "probable");
  const missing = matchCustomer({ name: "Cliente completamente diverso" }, customers).match;
  assert.equal(missing.status, "unmatched");
  assert.equal(missing.proposedId, null);
});

test("classifica prodotto certo e ambiguo soltanto nel catalogo Direct", () => {
  const products = [
    { codice_articolo: "IT001", descrizione: "Crema Corpo 500 ml", ean: "1111111111111" },
    { codice_articolo: "MKT001", descrizione: "Crema Corpo 500 ml", ean: "2222222222222" },
    { codice_articolo: "ZZ001", descrizione: "Crema Corpo 500 ml", ean: "3333333333333" },
  ];
  const exact = matchProduct({ ean: "1111111111111", description: "Crema" }, products);
  assert.equal(exact.match.status, "matched");
  assert.equal(exact.match.proposedId, "IT001");
  const ambiguous = matchProduct({ description: "Crema Corpo 500 ml" }, products);
  assert.equal(ambiguous.match.status, "ambiguous");
  assert.equal(ambiguous.candidates.some((item) => item.code === "ZZ001"), false);
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
