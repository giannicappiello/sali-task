import { applySequentialDiscounts } from "./orderEconomics.js";
export function excludesOrderPaymentDiscount(moduleCode) {
  return ["prof", "ph"].includes(String(moduleCode ?? "").trim().toLowerCase());
}
export function applyOrderPaymentDiscountPolicy(line, moduleCode) {
  if (!excludesOrderPaymentDiscount(moduleCode) || line.riga_spedizione) return line;
  const commercial = String(line.dettaglio_calcolo?.sconto_commerciale ?? line.sconto_commerciale ?? line.sconto ?? "").trim();
  const equivalent = Number((100 - applySequentialDiscounts(100, commercial)).toFixed(4));
  return { ...line, sconto_commerciale: commercial, sconto_pagamento: "", sconto_pagamento_percentuale: null,
    sconto_percentuale: equivalent, regola_pagamento_id: null, regola_pagamento: null,
    dettaglio_calcolo: { ...line.dettaglio_calcolo, escludi_sconto_pagamento: true,
      sconto_commerciale: commercial, sconto_pagamento: "", sconto_equivalente: equivalent } };
}
