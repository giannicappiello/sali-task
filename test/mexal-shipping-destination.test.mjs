import assert from "node:assert/strict";
import { buildMexalOrderDocument } from "../server/mexal/order-documents.js";

const payload = buildMexalOrderDocument({
  id: "workspace-test",
  codice_cliente: "501.03320",
  data_ordine: "2026-07-21",
  destinazione_mexal: {
    cod_anag_sped: "754",
    destinatario: "Cliente test",
  },
}, "OCM", [{
  codice_articolo: "IT0001",
  quantita_documento: 1,
  prezzo_listino: 4.6,
}], { serie: 1, magazzino: 1 });

assert.deepEqual(payload.cod_anag_sped, [[1, "754"]], "cod_anag_sped usa il codice anagrafico interno nel formato matrice verificato");
assert.equal(Object.hasOwn(payload, "id_ind_sped"), false, "id_ind_sped resta omesso quando il documento manuale lo restituisce vuoto");
assert.notDeepEqual(payload.cod_anag_sped, [[1, "501.03320"]], "il conto cliente non viene riutilizzato come codice destinatario");

console.log("Mexal shipping destination: internal anagraphic code verified");
