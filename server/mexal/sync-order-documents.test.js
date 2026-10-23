import test from "node:test";
import assert from "node:assert/strict";
import { isMissingMexalDocument, isOrderFullyMissingFromMexal, purgeEvictedOrderDocuments } from "./sync-order-documents.js";

test("riconosce come assente un documento eliminato da Mexal", () => {
  assert.equal(isMissingMexalDocument({ status: 404, message: "Not found" }), true);
  assert.equal(isMissingMexalDocument({ mexalResponse: { status: 410, body: "Risorsa non trovata" } }), true);
});

test("un ordine con tutti i documenti assenti non viene interpretato come evaso", () => {
  assert.equal(isOrderFullyMissingFromMexal([
    { numero: "11", stato_operativo: "ANNULLATO", presente_in_mexal: false },
  ]), true);
  assert.equal(isOrderFullyMissingFromMexal([
    { numero: "11", stato_operativo: "APERTO", presente_in_mexal: true },
  ]), false);
});

test("lo storico non viene cancellato neppure dai vecchi comandi di pulizia", async () => {
 const supabase={from(){throw new Error("Nessuna cancellazione o query consentita");}};
 const result=await purgeEvictedOrderDocuments({supabase,days:60});
 assert.equal(result.eliminati,0);
 assert.equal(result.conservazione_permanente,true);
});
