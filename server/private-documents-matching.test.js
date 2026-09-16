import assert from "node:assert/strict";
import test from "node:test";
import { documentsForLot } from "../src/pages/Documentation/private-documents-matching.js";

test("MP documents apply to present and future lots; lot files stay on their exact lot", () => {
  const general = { associationType: "Articolo", title: "MP2022_sds" };
  const specific = { associationType: "LottoMateriaPrima", title: "12345_coa", lotCode: "12345", productionOrderId: 10, stockLotId: 4 };
  const documents = [general, specific];
  assert.deepEqual(documentsForLot(documents, { lotCode: "12345", productionOrderId: 10, stockLotId: 4 }), documents);
  assert.deepEqual(documentsForLot(documents, { lotCode: "67890", productionOrderId: 10, stockLotId: 5 }), [general]);
  assert.deepEqual(documentsForLot(documents, { lotCode: "FUTURO" }), [general]);
});

test("historical associations without lot code use their most specific identifier", () => {
  const document = { associationType: "LottoMateriaPrima", stockLotId: 4, productionOrderId: 10 };
  assert.deepEqual(documentsForLot([document], { stockLotId: 5, productionOrderId: 10 }), []);
  assert.deepEqual(documentsForLot([document], { stockLotId: 4 }), [document]);
});
