import assert from "node:assert/strict";
import { buildMexalOrderDocument } from "../server/mexal/order-documents.js";

const payload = buildMexalOrderDocument({
  id: "workspace-test",
  codice_cliente: "501.02677",
  data_ordine: "2026-07-21",
  destinazione_mexal: {
    cod_anag_sped: "501.02677",
    id_ind_sped: 0,
  },
}, "OCM", [{
  codice_articolo: "IT0039",
  quantita_documento: 1,
  prezzo_listino: 1.5,
}], { serie: 1, magazzino: 5 });

assert.deepEqual(payload.id_ind_sped, [[1, 0]], "id_ind_sped deve usare il formato array/matrice richiesto da Mexal");
assert.equal(payload.cod_anag_sped, "501.02677", "cod_anag_sped resta nel formato già accettato finché Mexal non segnala un contratto diverso");

console.log("Mexal destination payload: id_ind_sped matrix verified");
