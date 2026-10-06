// An unknown country must retain normal article VAT validation.
export function isForeignOrderCustomer(customer) {
  const country = String(customer?.paese ?? "").trim().toUpperCase();
  return Boolean(country) && !["IT", "ITA", "ITALIA", "ITALY", "380"].includes(country);
}

export function applyOrderVatPolicy(line, customer) {
  const foreign = isForeignOrderCustomer(customer);
  return foreign ? { ...line, iva_non_applicata: true, cod_iva: null,
    codice_iva_mexal: null, aliquota_iva: null, iva_percentuale: null, iva: null,
    iva_riga: 0, totale_riga: line.imponibile_riga ?? line.totale_riga,
    dettaglio_calcolo: { ...line.dettaglio_calcolo, ripartizione_iva: [] } }
    : { ...line, iva_non_applicata: false };
}
