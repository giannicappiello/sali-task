import assert from "node:assert/strict";
import { calculateCommissions, customerCommissionCategory, productCommissionCategory } from "../server/mexal/commission-engine.js";
import { buildMexalOrderDocument, formatMexalCommission } from "../server/mexal/order-documents.js";
assert.equal(productCommissionCategory({ dati_mexal: { id_categoria_pr: 3 } }), 3);
assert.equal(customerCommissionCategory({ dati_mexal: { cod_cat_pr: 2 } }), 2);
const base = { order: { codice_agente_mexal: "602.00063" }, customer: { codice_cliente: "501.00861", dati_mexal: { cod_cat_pr: 2 } }, lines: [{ id: "line", codice_articolo: "IT0001" }], products: [{ codice_articolo: "IT0001", dati_mexal: { id_categoria_pr: 3 } }] };
let result = calculateCommissions({ ...base, rules: [{ id: "generic", categoria_cliente: 2, categoria_prodotto: 3, percentuale: 7.5, attiva: true }] });
assert.equal(result[0].provvigione_percentuale, 7.5);
result = calculateCommissions({ ...base, rules: [{ id: "generic", categoria_cliente: 2, categoria_prodotto: 3, percentuale: 7.5, attiva: true }, { id: "agent", categoria_cliente: 2, categoria_prodotto: 3, codice_agente_mexal: "602.00063", percentuale: 8, attiva: true }] });
assert.equal(result[0].provvigione_percentuale, 8);
assert.throws(() => calculateCommissions({ ...base, rules: [] }), /Nessuna regola/);
assert.throws(() => calculateCommissions({ ...base, products: [{}], rules: [] }), /Categoria provvigionale prodotto assente/);
assert.throws(() => calculateCommissions({ ...base, customer: {}, rules: [] }), /Categoria provvigionale cliente assente/);
assert.throws(() => calculateCommissions({ ...base, rules: [{ categoria_cliente: 2, categoria_prodotto: 3, percentuale: 101, attiva: true }] }), /percentuale.*valida/);
assert.equal(formatMexalCommission(7.5), "7,5"); assert.equal(formatMexalCommission(10), "10");
for (const kind of ["OCM", "OCI", "OCX"]) { const document = buildMexalOrderDocument({ codice_cliente: "C", data_ordine: "2026-07-22", codice_agente_mexal: "602.00063" }, kind, [{ codice_articolo: "IT0001", quantita_documento: 1, provvigione_percentuale: 7.5 }]); assert.deepEqual(document.perc_provv, [[1, 7.5]]); assert.deepEqual(document.cod_agente, [[1, 1, "602.00063"]]); assert.deepEqual(document.tipo_provv, [[1,1,"%"],[1,2,"%"],[1,3,"%"],[1,4,"%"],[1,5,"%"]]); assert.deepEqual(document.formula_pr, [[1,1,"7,5"]]); assert.deepEqual(document.calc_formula_pr, [[1,1,7.5]]); }
