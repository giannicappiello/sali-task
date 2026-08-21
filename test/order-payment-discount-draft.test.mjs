import assert from "node:assert/strict";
import { calculateOrderLineEconomicsWithPayment } from "../src/modules/orders/services/orderEconomics.js";

const savedDraftLine = {
  quantita: 2,
  prezzo_listino: 100,
  sconto_commerciale: "10+5",
  sconto_pagamento: "5",
  aliquota_iva: 22,
  dettaglio_calcolo: {
    sconto_commerciale: "10",
    sconto_pagamento: "5",
  },
};

const firstOpening = calculateOrderLineEconomicsWithPayment(savedDraftLine);
const secondOpening = calculateOrderLineEconomicsWithPayment(firstOpening);

assert.equal(firstOpening.sconto_commerciale, "10");
assert.equal(firstOpening.sconto_pagamento, "5");
assert.equal(firstOpening.prezzo_netto, 85.5);
assert.equal(secondOpening.prezzo_netto, 85.5);
assert.equal(secondOpening.imponibile_riga, firstOpening.imponibile_riga);

console.log("bozza ordine: lo sconto pagamento viene applicato una sola volta");
