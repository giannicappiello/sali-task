import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  calculateOrderEconomics,
  parseDiscountSequence,
} from "../src/modules/orders/services/orderEconomics.js";

assert.deepEqual(parseDiscountSequence("10%"), [10]);
assert.deepEqual(parseDiscountSequence("50+35+10%"), [50, 35, 10]);
assert.deepEqual(parseDiscountSequence("10,00%"), [10]);

const result = calculateOrderEconomics([
  {
    quantita: 1,
    prezzo_listino: 6.67,
    sconto_commerciale: "50+35+10%",
    aliquota_iva: 22,
  },
]);

assert.equal(result.righe[0].imponibile_riga, 1.95);
assert.equal(result.righe[0].iva_riga, 0.43);
assert.equal(result.righe[0].totale_riga, 2.38);

const agentNames = await readFile(
  new URL("../src/modules/orders/services/agentNames.js", import.meta.url),
  "utf8"
);
const orderDetail = await readFile(
  new URL("../src/modules/orders/pages/OrderDetail.jsx", import.meta.url),
  "utf8"
);

assert.match(agentNames, /\[user\.cognome, user\.nome\]/);
assert.doesNotMatch(agentNames, /map\.get\(code\)\s*\|\|\s*code/);
assert.match(orderDetail, /loadAgentNameMap/);
assert.match(orderDetail, /codice_agente_mexal: agentName/);

console.log("Nome agente e sconto pagamento percentuale verificati.");
