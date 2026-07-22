import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateLineConditions } from "../src/modules/orders/services/priceEngine.js";
import { parseDiscountSequence } from "../src/modules/orders/services/orderEconomics.js";

assert.deepEqual(parseDiscountSequence("10%"), [10]);
assert.deepEqual(parseDiscountSequence("50+35+10%"), [50, 35, 10]);
assert.deepEqual(parseDiscountSequence("10,00%"), [10]);

const product = { prezzo_listino: 100 };
for (const [code, discount] of [["15", "5%"], ["0043", "10,00%"]]) {
  const result = calculateLineConditions({
    customer: { codice_pagamento: code }, product,
    paymentRules: [{ codice_pagamento: Number(code), sconto_esteso: discount, is_active: true }],
  });
  assert.equal(Number(result.sconto_pagamento), Number(discount.replace(/[^0-9.,]/g, "").replace(",", ".")));
}

const chained = calculateLineConditions({
  customer: { codice_pagamento: "43", categoria_sconto: 1 }, product: { prezzo_listino: 6.67, categoria_sconto: 1 },
  discountMatrix: [{ cod_cat_cli: 1, cod_cat_art: 1, sconto_esteso: "50+35", is_active: true }],
  paymentRules: [{ codice_pagamento: "43", sconto_esteso: "10%", is_active: true }],
});
assert.equal(chained.sconto_commerciale, "50+35");
assert.equal(chained.sconto_pagamento, "10");
assert.equal(chained.prezzo_netto, 1.951);

const agentNames = await readFile(new URL("../src/modules/orders/services/agentNames.js", import.meta.url), "utf8");
const commercialSync = await readFile(new URL("../server/mexal/sync-commercial-conditions.js", import.meta.url), "utf8");
assert.match(agentNames, /export function formatAgentName/);
assert.match(agentNames, /\[surname, name\]\.filter\(Boolean\)\.join\(" "\)/);
assert.match(agentNames, /\.from\("integrazioni_utenti"\)/);
assert.doesNotMatch(agentNames, /ordini_agenti_cache/);
assert.match(commercialSync, /"\/dati-generali\/pagamenti"/);
assert.match(commercialSync, /normalizePaymentCode/);

console.log("Regole pagamento 15/43, catena sconti e nominativo agente verificati.");
