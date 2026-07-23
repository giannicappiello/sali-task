import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [moduleSource, customersSource, dashboardSource, mexalSettingsSource] = await Promise.all([
  readFile("src/modules/orders/OrdersModule.jsx", "utf8"),
  readFile("src/modules/orders/pages/Customers.jsx", "utf8"),
  readFile("src/modules/orders/pages/OrdersDashboard.jsx", "utf8"),
  readFile("src/modules/integrations/components/MexalSettings.jsx", "utf8"),
]);

assert.doesNotMatch(moduleSource, /Materiali|pages\/Materials|path="materiali"/);
assert.match(moduleSource, /path="clienti\/:customerCode"/);
assert.match(moduleSource, /"Prodotto"[\s\S]*"Quantità"[\s\S]*"Disponibile"[\s\S]*"Listino"[\s\S]*"Sconto commerciale"[\s\S]*"Netto"[\s\S]*"Imponibile"[\s\S]*"IVA"[\s\S]*"Totale"/);
assert.match(moduleSource, /const netUnit = quantity > 0 \? taxable \/ quantity : 0/);
assert.doesNotMatch(dashboardSource, /Confronta documenti Mexal/);
assert.match(mexalSettingsSource, /Confronta documenti Mexal/);
assert.doesNotMatch(customersSource, /<th>Codice<\/th>|<th>Pagamento<\/th>|<th>Listino<\/th>/);
assert.match(customersSource, /navigate\(`\/ordini\/clienti\/\$\{encodeURIComponent\(item\.codice_cliente\)\}`\)/);

console.log("orders Word UI changes verified");
