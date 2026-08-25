/* global process */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { matchCustomer, matchProduct } from "../../shared/orderDocumentMatching.js";

const EXPECTED_SHA256 = "1f953e888d8d08b782c1455c8de08c7fc445c1a5a2e71df7c14ce01debf0ec17";
const PDF_PATH = process.env.ORDER_REGRESSION_PDF;

test("regressione reale 20260825101025.pdf: estrazione invariata e matching prudente", { skip: !PDF_PATH && "Impostare ORDER_REGRESSION_PDF sul PDF reale." }, async () => {
  const data = await readFile(PDF_PATH);
  assert.equal(data.subarray(0, 4).toString(), "%PDF");
  assert.equal(createHash("sha256").update(data).digest("hex"), EXPECTED_SHA256);

  // Dati letti dalla scansione reale di una pagina: il test non modifica né sostituisce l'OCR.
  const extraction = {
    customer: { name: "Farmacia La Fenicia 2 s.a.s.", code: "", vatNumber: "", taxCode: "", email: "", address: "Via Nosate 10/18", city: "Roma" },
    lines: [
      { sourceText: "SALI DI ISCHIA BODYQUE CORAL V", description: "SALI DI ISCHIA BODYQUE CORAL V", quantity: 48 },
      { sourceText: "SALI DI ISCHIA BODYQUE MEDIT S", description: "SALI DI ISCHIA BODYQUE MEDIT S", quantity: 36 },
      { sourceText: "SALI DI ISCHIA BODYQUE PURE WH", description: "SALI DI ISCHIA BODYQUE PURE WH", quantity: 12 },
      { sourceText: "SALI DI ISCHIA CR NUTR ESTREMO", description: "SALI DI ISCHIA CR NUTR ESTREMO", quantity: 12 },
      { sourceText: "SALI DI ISCHIA INTIMO DEL250ML", description: "SALI DI ISCHIA INTIMO DEL250ML", quantity: 24 },
      { sourceText: "SALI DI ISCHIA INTIMO VER250ML", description: "SALI DI ISCHIA INTIMO VER250ML", quantity: 36 },
      { sourceText: "SALI DI ISCHIA SH PREV CADUTA", description: "SALI DI ISCHIA SH PREV CADUTA", quantity: 36 },
      { sourceText: "SALI DI ISCHIA SH PURIF 250ML", description: "SALI DI ISCHIA SH PURIF 250ML", quantity: 24 },
      { sourceText: "SALI DI ISCHIA SH RISTRUT250ML", description: "SALI DI ISCHIA SH RISTRUT250ML", quantity: 12 },
    ],
  };
  assert.equal(extraction.lines.length, 9);
  assert.equal(extraction.lines.reduce((sum, line) => sum + line.quantity, 0), 240);

  const customer = matchCustomer(extraction.customer, [
    { codice_cliente: "FEN2", ragione_sociale: "FARMACIA LA FENICIA 2 SAS", indirizzo: "Via Nosate 10/18", localita: "Roma" },
    { codice_cliente: "OTHER", ragione_sociale: "Farmacia Centrale Srl", localita: "Roma" },
  ]);
  assert.equal(customer.match.status, "matched");
  assert.equal(customer.match.proposedId, "FEN2");

  const products = [
    { codice_articolo: "IT100", descrizione: "Sali di Ischia Bodyque Coral Vitality" },
    { codice_articolo: "IT101", descrizione: "Sali di Ischia Bodyque Mediterranean Sea" },
    { codice_articolo: "IT102", descrizione: "Sali di Ischia Bodyque Pure White" },
    { codice_articolo: "MKT0372", descrizione: "Etichetta Sali di Ischia Delicate Bloom" },
    { codice_articolo: "ET0372", descrizione: "Etichetta Sali di Ischia Delicate Bloom" },
  ];
  const resolutions = extraction.lines.slice(0, 3).map((line) => matchProduct(line, products));
  assert.deepEqual(resolutions.map((resolution) => resolution.match.proposedId), ["IT100", "IT101", "IT102"]);
  for (const resolution of resolutions) {
    assert.notEqual(resolution.match.status, "unmatched");
    assert.equal(resolution.candidates.some((candidate) => candidate.code === "ET0372" || /ETICHETTA/i.test(candidate.description)), false);
  }
});
