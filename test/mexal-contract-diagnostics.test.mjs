import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeContract } from "../api/mexal/order-contract-diagnostics.js";

const api = await readFile("api/mexal/order-contract-diagnostics.js", "utf8");
const app = await readFile("src/App.jsx", "utf8");
const page = await readFile("src/pages/Settings/MexalDiagnostics.jsx", "utf8");

assert.match(api, /if \(!authorization\?\.isAdmin\)/, "l'endpoint è riservato agli amministratori");
assert.match(api, /Riferimento non valido\. Usa il formato OC\+SERIE\+NUMERO/, "i riferimenti documento sono validati");
assert.match(app, /settings\/mexal-diagnostics/, "la pagina diagnostica è raggiungibile dalle route protette");
assert.match(page, /\/api\/mexal\/order-contract-diagnostics/, "la pagina usa l'endpoint server-side Vercel");

const sanitized = sanitizeContract({
  stato: "E",
  cod_modulo: "M",
  sospeso: false,
  cod_conto: "501.00001",
  indirizzo: "Via riservata",
  prezzo: 15.5,
  id_riga: [[1, 1]],
});

assert.equal(sanitized.stato.value, "E");
assert.equal(sanitized.cod_modulo.value, "M");
assert.equal(sanitized.sospeso.value, false);
assert.equal(sanitized.cod_conto.value, undefined);
assert.equal(sanitized.indirizzo.value, undefined);
assert.equal(sanitized.prezzo.value, undefined);
assert.equal(sanitized.id_riga[0][0].value, 1);

console.log("Mexal contract diagnostics: admin protection, route and sanitization verified");
