import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [newOrder, detail] = await Promise.all([
  readFile("src/modules/orders/pages/NewOrder.jsx", "utf8"),
  readFile("src/modules/orders/pages/OrderDetail.jsx", "utf8"),
]);

assert.match(newOrder, /editingOrderId && !confirm[\s\S]*quantita_ocm: 0[\s\S]*: quantities/,
  "la modifica azzera la ripartizione soltanto quando salva nuovamente in bozza");
assert.match(detail, /\["ph", "private"\]\.includes\(moduleCode\) && isDraft[\s\S]*onClick=\{confirmDraft\}/,
  "una bozza PH espone la conferma diretta dal dettaglio");
assert.match(detail, /confirmDraft[\s\S]*updateOrder[\s\S]*conferma_ordine_workspace[\s\S]*moduleCode === "ph"[\s\S]*Ordine PH confermato senza invio a Mexal/,
  "la conferma diretta prepara le righe e conferma l'ordine PH senza inviarlo a Mexal");

console.log("conferma diretta bozza OrdiniPH: ok");
