import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateLineConditions,
  mexalArticleListDiscount,
  usesMexalArticleListDiscount,
} from "../../src/modules/orders/services/priceEngine.js";

const customer = { codice_listino: "1", categoria_sconti: 2 };

function product(code, discount = "99,99") {
  return {
    codice_articolo: code,
    prezzo_listino: 100,
    dati_mexal: { codice: code, sconto_listino: [[1, discount]] },
  };
}

test("limita lo sconto anagrafico ai codici MKT e agli IT con suffisso TST o CMP", () => {
  for (const code of ["MKT0001", "IT0019-TST", "IT0542-CMP"]) {
    assert.equal(usesMexalArticleListDiscount(product(code)), true, code);
  }
  for (const code of ["BT0001-CMP", "CO0005-TST", "IT0001", "AMKT0001"]) {
    assert.equal(usesMexalArticleListDiscount(product(code)), false, code);
  }
});

test("legge lo sconto dal listino cliente nell'anagrafica articolo Mexal", () => {
  const item = product("IT0542-CMP");
  item.dati_mexal.sconto_listino = [[1, "50"], [2, "99,99"]];
  assert.equal(mexalArticleListDiscount(item, { codice_listino: "2" }), "99.99");
});

test("applica il 99,99 Mexal al posto della matrice ordinaria", () => {
  const result = calculateLineConditions({
    customer,
    product: product("IT0542-CMP"),
    quantity: 1,
    discountMatrix: [{ cod_cat_cli: 2, cod_cat_art: 0, sconto: "10", is_active: true }],
  });
  assert.equal(result.sconto_commerciale, "99.99");
  assert.equal(result.prezzo_netto, 0.01);
  assert.equal(result.origine_sconto, "anagrafica-articolo-mexal");
});

test("non forza lo sconto sui suffissi TST e CMP non IT", () => {
  const result = calculateLineConditions({
    customer,
    product: product("BT0001-CMP"),
    quantity: 1,
  });
  assert.equal(result.sconto_commerciale, "");
  assert.equal(result.prezzo_netto, 100);
  assert.equal(result.origine_sconto, "nessuno");
});

test("applica la particolarità della categoria statistica cliente Mexal", () => {
  const result = calculateLineConditions({
    customer: {
      codice_cliente: "501.00288",
      categoria_sconti: 2,
      dati_mexal: { cod_cat_sta: 2 },
    },
    product: {
      codice_articolo: "IT0001",
      prezzo_listino: 4.6,
      categoria_sconto: 7,
      dati_mexal: { nr_cat_sta: 2 },
    },
    quantity: 1,
    orderDate: "2026-09-14",
    discountMatrix: [
      { cod_cat_cli: 2, cod_cat_art: 7, sconto_esteso: "50+35", is_active: true },
    ],
    specialConditions: [
      {
        id: 54,
        tipo_part: "S",
        tp_dato_conto: "S",
        id_catsta_conto: 2,
        tp_dato_art: "E",
        nr_catsta_art: 2,
        part_1: [[4, "50+35+10"]],
        data_inizio: "2025-01-24",
        is_active: true,
      },
    ],
  });

  assert.equal(result.sconto_commerciale, "50+35+10");
  assert.equal(result.origine_sconto, "particolarita-sconto");
  assert.equal(result.regola_sconto_id, 54);
  assert.equal(result.prezzo_netto, 1.3455);
});
