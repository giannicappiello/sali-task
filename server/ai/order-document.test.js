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

test("normalizza Farmacia La Fenicia 2 s.a.s. senza confonderla con altre farmacie", () => {
  const customers = [
    { codice_cliente: "FEN2", ragione_sociale: "Farmacia La Fenicia 2 S.A.S.", localita: "Roma" },
    { codice_cliente: "FEN1", ragione_sociale: "Farmacia Fenice S.r.l.", localita: "Roma" },
    { codice_cliente: "ALT1", ragione_sociale: "Farmacia Centrale S.r.l.", localita: "Milano" },
  ];
  const resolution = matchCustomer({ name: "Farmacia La Fenicia 2 s.a.s.", city: "Roma" }, customers);
  assert.equal(resolution.match.status, "matched");
  assert.equal(resolution.match.proposedId, "FEN2");
  assert.equal(resolution.candidates.some((candidate) => candidate.code === "ALT1"), false);
});

test("cliente ambiguo resta da confermare e cliente lontano resta unmatched", () => {
  const customers = [
    { codice_cliente: "A1", ragione_sociale: "Parafarmacia Aurora Uno Srl" },
    { codice_cliente: "A2", ragione_sociale: "Parafarmacia Aurora Due Srl" },
  ];
  assert.equal(matchCustomer({ name: "Parafarmacia Aurora" }, customers).match.status, "ambiguous");
  const missing = matchCustomer({ name: "La Fenicia 2" }, [{ codice_cliente: "X", ragione_sociale: "Farmacia Centrale Milano" }]);
  assert.equal(missing.match.status, "unmatched");
  assert.deepEqual(missing.match.alternatives, []);
});

test("gerarchia prodotto: codice, EAN e descrizione esatta", () => {
  const products = [
    { codice_articolo: "IT100", descrizione: "Bodyque Coral Vitality", ean: "8050000000100", sku: "CORAL-100" },
    { codice_articolo: "IT200", descrizione: "Bodyque Pure White", ean: "8050000000200", sku: "PURE-200" },
  ];
  assert.equal(matchProduct({ productCode: "IT-100" }, products).match.proposedId, "IT100");
  assert.equal(matchProduct({ ean: "8050000000200" }, products).match.proposedId, "IT200");
  assert.equal(matchProduct({ description: "Bodyque Coral Vitality" }, products).match.status, "matched");
});

test("regressione BODYQUE usa token distintivi ed esclude packaging/ET", () => {
  const products = [
    { codice_articolo: "IT100", descrizione: "Sali di Ischia Bodyque Coral Vitality" },
    { codice_articolo: "IT101", descrizione: "Sali di Ischia Bodyque Mediterranean Sea" },
    { codice_articolo: "IT102", descrizione: "Sali di Ischia Bodyque Pure White" },
    { codice_articolo: "MKT0372", descrizione: "Etichetta Sali di Ischia Delicate Bloom" },
    { codice_articolo: "ET0372", descrizione: "Etichetta Sali di Ischia Delicate Bloom" },
  ];
  assert.equal(matchProduct({ sourceText: "SALI DI ISCHIA BODYQUE CORAL V", description: "SALI DI ISCHIA BODYQUE CORAL V" }, products).match.proposedId, "IT100");
  assert.equal(matchProduct({ sourceText: "SALI DI ISCHIA BODYQUE MEDIT S", description: "SALI DI ISCHIA BODYQUE MEDIT S" }, products).match.proposedId, "IT101");
  assert.equal(matchProduct({ sourceText: "SALI DI ISCHIA BODYQUE PURE WH", description: "SALI DI ISCHIA BODYQUE PURE WH" }, products).match.proposedId, "IT102");
  for (const sourceText of ["SALI DI ISCHIA BODYQUE CORAL V", "SALI DI ISCHIA BODYQUE MEDIT S", "SALI DI ISCHIA BODYQUE PURE WH"]) {
    const resolution = matchProduct({ sourceText, description: sourceText }, products);
    assert.equal(resolution.candidates.some((candidate) => /ETICHETTA/i.test(candidate.description) || candidate.code.startsWith("ET")), false);
  }
});

test("BODYQUE senza candidato plausibile è unmatched, non un'etichetta", () => {
  const resolution = matchProduct(
    { sourceText: "SALI DI ISCHIA BODYQUE CORAL V", description: "SALI DI ISCHIA BODYQUE CORAL V" },
    [{ codice_articolo: "MKT0372", descrizione: "Etichetta Sali di Ischia Delicate Bloom" }],
  );
  assert.equal(resolution.match.status, "unmatched");
  assert.equal(resolution.match.proposedId, null);
  assert.deepEqual(resolution.candidates, []);
});

test("prodotti simili restano ambiguous e un testo estraneo resta unmatched", () => {
  const products = [
    { codice_articolo: "IT301", descrizione: "Bodyque Coral Vitality 500 ml" },
    { codice_articolo: "IT302", descrizione: "Bodyque Coral Vitality 250 ml" },
  ];
  assert.equal(matchProduct({ description: "Bodyque Coral Vitality" }, products).match.status, "ambiguous");
  assert.equal(matchProduct({ description: "Ricambio macchina industriale" }, products).match.status, "unmatched");
});
