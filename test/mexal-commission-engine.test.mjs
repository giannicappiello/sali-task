import assert from "node:assert/strict";
import { calculateCommissions, customerCommissionCategory, productCommissionCategory, productMexalVatCode } from "../server/mexal/commission-engine.js";
import { buildMexalOrderDocument, formatMexalCommission } from "../server/mexal/order-documents.js";
assert.equal(productCommissionCategory({ dati_mexal: { id_categoria_pr: 3 } }), 3);
assert.equal(customerCommissionCategory({ dati_mexal: { cod_cat_pr: 2 } }), 2);
assert.equal(productMexalVatCode({ dati_mexal: { cod_iva: "22,0" } }), "22,0");
const base = { order: { codice_agente_mexal: "602.00063" }, customer: { codice_cliente: "501.00861", dati_mexal: { cod_cat_pr: 2 } }, lines: [{ id: "line", codice_articolo: "IT0001" }], products: [{ codice_articolo: "IT0001", dati_mexal: { id_categoria_pr: 3, cod_iva: "22,0" } }] };
let result = calculateCommissions({ ...base, rules: [{ id: "generic", categoria_cliente: 2, categoria_prodotto: 3, percentuale: 7.5, attiva: true }] });
assert.equal(result[0].provvigione_percentuale, 7.5);
assert.equal(result[0].codice_iva_mexal, "22,0", "la riga eredita il codice IVA dalla cache prodotto");
result = calculateCommissions({ ...base, rules: [{ id: "generic", categoria_cliente: 2, categoria_prodotto: 3, percentuale: 7.5, attiva: true }, { id: "agent", categoria_cliente: 2, categoria_prodotto: 3, codice_agente_mexal: "602.00063", percentuale: 8, attiva: true }] });
assert.equal(result[0].provvigione_percentuale, 8);
assert.throws(() => calculateCommissions({ ...base, rules: [] }), /Nessuna regola/);
assert.throws(() => calculateCommissions({ ...base, products: [{}], rules: [] }), /Categoria provvigionale prodotto assente/);
assert.throws(() => calculateCommissions({ ...base, customer: {}, rules: [] }), /Categoria provvigionale cliente assente/);
assert.throws(() => calculateCommissions({ ...base, rules: [{ categoria_cliente: 2, categoria_prodotto: 3, percentuale: 101, attiva: true }] }), /percentuale.*valida/);
assert.equal(formatMexalCommission(7.5), "7,5"); assert.equal(formatMexalCommission(10), "10");
for (const kind of ["OCM", "OCI", "OCX"]) { const document = buildMexalOrderDocument({ codice_cliente: "C", data_ordine: "2026-07-22", codice_agente_mexal: "602.00063" }, kind, [{ codice_articolo: "IT0001", quantita_documento: 1, provvigione_percentuale: 7.5 }]); assert.deepEqual(document.perc_provv, [[1, 7.5]]); assert.deepEqual(document.cod_agente, [[1, 1, "602.00063"]]); assert.deepEqual(document.tipo_provv, [[1,1,"%"],[1,2,"%"],[1,3,"%"],[1,4,"%"],[1,5,"%"]]); assert.deepEqual(document.formula_pr, [[1,1,"7,5"]]); assert.deepEqual(document.calc_formula_pr, [[1,1,7.5]]); }

const impCommissioned = calculateCommissions({
  order: { codice_agente_mexal: "602.00063" },
  customer: { codice_cliente: "501.00861", dati_mexal: { cod_cat_pr: 2 } },
  lines: [{ id: "imp-line", codice_articolo: "IMP0001", quantita: 3 }],
  products: [{ codice_articolo: "IMP0001", dati_mexal: { id_categoria_pr: 3, cod_iva: "22,0" } }],
  rules: [{ id: "generic", categoria_cliente: 2, categoria_prodotto: 3, percentuale: 7.5, attiva: true }],
});
const impDocument = buildMexalOrderDocument({ codice_cliente: "C", data_ordine: "2026-07-22", codice_agente_mexal: "602.00063" }, "OCI", [{ ...impCommissioned[0], quantita_documento: 3 }]);
assert.deepEqual(impDocument.cod_iva, [[1, "22,0"]], "OCI invia l'aliquota IVA obbligatoria della riga IMP");

const splitSource = [{ codice_articolo: "IT-SPLIT", quantita: 10, quantita_ocm: 6, quantita_ocx: 4, provvigione_percentuale: 7.5 }, { codice_articolo: "IMP0001", quantita: 3, quantita_ocm: 3, quantita_ocx: 0, provvigione_percentuale: 7.5 }];
const split = (await import("../server/mexal/order-documents.js")).classifyOrderLines(splitSource);
assert.deepEqual(split.OCM.map(({ codice_articolo, quantita_documento }) => [codice_articolo, quantita_documento]), [["IT-SPLIT", 6]], "OCM split remains unchanged");
assert.deepEqual(split.OCX.map(({ codice_articolo, quantita_documento }) => [codice_articolo, quantita_documento]), [["IT-SPLIT", 4]], "OCX split remains unchanged");
assert.deepEqual(split.OCI.map(({ codice_articolo, quantita_documento }) => [codice_articolo, quantita_documento]), [["IMP0001", 3]], "OCI split remains unchanged");
for (const documentLines of Object.values(split)) assert.ok(documentLines.every((line) => line.provvigione_percentuale === 7.5), "the commission snapshot follows every split line");
