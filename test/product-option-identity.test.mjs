import assert from "node:assert/strict";
import test from "node:test";
import {
  findMexalProductByCode,
  PRODUCT_OPTION_KIND,
  productOptionKey,
  productOptionTypeLabel,
} from "../src/modules/orders/lib/productOptionIdentity.js";

test("articolo Mexal e impianto locale con lo stesso codice mantengono identità distinte", () => {
  const mexal = { codice_articolo: "IMP-SOL01", option_kind: PRODUCT_OPTION_KIND.MEXAL };
  const implant = { id: 91, codice: "IMP-SOL01", is_impianto: true, option_kind: PRODUCT_OPTION_KIND.LOCAL_IMPLANT };

  assert.equal(productOptionKey(mexal), "mexal-product:IMP-SOL01");
  assert.equal(productOptionKey(implant), "local-implant:91");
  assert.notEqual(productOptionKey(mexal), productOptionKey(implant));
  assert.equal(productOptionTypeLabel(mexal), "Articolo Mexal");
  assert.equal(productOptionTypeLabel(implant), "Impianto locale");
});

test("il recupero di una riga ordine preferisce sempre l'articolo Mexal", () => {
  const implant = { id: 91, codice_articolo: "IMP-SOL01", is_impianto: true };
  const mexal = { codice_articolo: "IMP-SOL01", option_kind: PRODUCT_OPTION_KIND.MEXAL };
  assert.equal(findMexalProductByCode([implant, mexal], "imp-sol01"), mexal);
});
