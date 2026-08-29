import assert from "node:assert/strict";
import test from "node:test";
import { buildMexalOrderDocument, classifyPrivateOrderLines } from "./order-documents.js";

test("OrdiniPrivate mantiene tutte le righe in un unico OCT", () => {
  const result = classifyPrivateOrderLines([
    { codice_articolo: "IT0001", quantita: 2, quantita_ocm: 1, quantita_ocx: 1 },
    { codice_articolo: "MKT001", quantita: 3, quantita_oci: 3 },
  ]);
  assert.deepEqual(Object.keys(result), ["OCT"]);
  assert.deepEqual(result.OCT.map((line) => line.quantita_documento), [2, 3]);
  assert.equal(result.OCM, undefined);
  assert.equal(result.OCX, undefined);
  assert.equal(result.OCI, undefined);
});

test("payload OCT usa esclusivamente il codice modulo reale configurato", () => {
  const payload = buildMexalOrderDocument(
    { id: "private-1", codice_cliente: "501.00001", data_ordine: "2026-08-29" },
    "OCT",
    [{ codice_articolo: "IT0001", quantita_documento: 4 }],
    { serie: 2, moduleCode: "T" },
  );
  assert.equal(payload.sigla, "OC");
  assert.equal(payload.serie, 2);
  assert.equal(payload.cod_modulo, "T");
  assert.deepEqual(payload.codice_articolo, [[1, "IT0001"]]);
  assert.deepEqual(payload.quantita, [[1, 4]]);
});

test("payload OCT fallisce se il codice modulo Mexal non è certificato", () => {
  assert.throws(() => buildMexalOrderDocument(
    { id: "private-2", codice_cliente: "501.00001", data_ordine: "2026-08-29" },
    "OCT",
    [{ codice_articolo: "IT0001", quantita_documento: 1 }],
    { serie: 2 },
  ), /Codice modulo Mexal mancante per OCT/);
});
