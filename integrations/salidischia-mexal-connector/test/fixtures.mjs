export function exampleOrder() {
  return {
    id: 13729, number: '13729', customer_id: 99, status: 'completed', currency: 'EUR',
    date_created: '2026-10-19T18:29:00', date_paid: '2026-10-19T18:29:00', payment_method: 'paypal',
    billing: { first_name: 'Nome', last_name: 'Esempio', company: 'Azienda esempio', address_1: 'Via Esempio 1', address_2: 'Scala B', postcode: '80131', city: 'Napoli', state: 'NA', country: 'IT', email: 'cliente@example.invalid', phone: '000000000' },
    shipping: { first_name: 'Nome', last_name: 'Esempio', address_1: 'Via Consegna 2', postcode: '00100', city: 'Roma', state: 'RM', country: 'IT' },
    meta_data: [{ key: 'billing_pec', value: 'pec@example.invalid' }, { key: 'codice_univoco', value: 'ABC1234' }, { key: 'p_iva', value: '00000000000' }, { key: 'tipologia', value: 'azienda' }],
    line_items: [
      { id: 1, sku: 'IT0017', name: 'Prodotto A', quantity: 12, subtotal: '77.11', total: '77.11', total_tax: '16.97', taxes: [{ id: 1, total: '16.97' }] },
      { id: 2, sku: 'IT0007', name: 'Prodotto B', quantity: 2, subtotal: '26.33', total: '26.33', total_tax: '5.79', taxes: [{ id: 1, total: '5.79' }] },
      { id: 3, sku: 'IT0478', name: 'Prodotto C', quantity: 2, subtotal: '12.79', total: '12.79', total_tax: '2.81', taxes: [{ id: 1, total: '2.81' }] },
    ],
    shipping_lines: [{ id: 4, method_title: 'Corriere Espresso', total: '15.00', total_tax: '3.30', taxes: [{ id: 1, total: '3.30' }] }],
    shipping_total: '15.00', shipping_tax: '3.30', total_tax: '28.87', total: '160.10', refunds: [], fee_lines: [],
  };
}
export const options = { company: 'TEST', year: 2026 };
export const config = { module: 'X', series: 1, warehouse: 5, taxCodes: { 1: '22' }, shippingTaxVerified: true, shippingTaxCode: '22', cutoverVerified: true, contractVerified: true };
