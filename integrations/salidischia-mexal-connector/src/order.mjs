import { createHash } from 'node:crypto';
import {resolveMexalSku} from './sku.mjs';
import {sameFirstDecimal} from './money-policy.mjs';

const text = value => String(value ?? '').trim();
function fail(message) { throw new Error(message); }
export function decimal(value, scale = 2) {
  const s = text(value);
  if (!/^\d+(\.\d+)?$/.test(s)) fail(`Importo non valido: ${s}`);
  const [whole, fraction = ''] = s.split('.');
  if (fraction.slice(scale).replace(/0/g, '')) fail('Precisione importo non supportata.');
  const result = Number(BigInt(whole) * 10n ** BigInt(scale) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale)));
  if (!Number.isSafeInteger(result)) fail('Importo troppo grande.');
  return result;
}
export const euros = cents => cents / 100;
const sum = values => values.reduce((a, b) => a + b, 0);
const address = data => Object.fromEntries(['first_name', 'last_name', 'company', 'address_1', 'address_2', 'postcode', 'city', 'state', 'country', 'phone', 'email'].map(key => [key, text(data?.[key])]));
function meta(order, keys) {
  for (const key of keys) {
    const found = (order.meta_data || []).find(row => row.key === key && text(row.value));
    if (found) return text(found.value);
  }
  return '';
}
function taxRows(item) {
  const taxes = (item.taxes || []).filter(tax => tax.id!==undefined && tax.id!==null && String(tax.id)!=='');
  const zeroLine = decimal(item.total) === 0 && decimal(item.total_tax || '0') === 0;
  return taxes.map(tax => ({ id: String(tax.id), cents: decimal(text(tax.total) === '' && zeroLine ? '0' : tax.total) }));
}
export function prepareOrder(order, { site = 'https://salidischia.it', company, year, catalogSkuAliases={} } = {}) {
  if (!company || !/^\d{4}$/.test(String(year))) fail('Azienda e anno Mexal obbligatori.');
  const origin = new URL(site).origin;
  if (!Number.isSafeInteger(Number(order.id)) || Number(order.id) <= 0) fail('ID ordine non valido.');
  if (order.currency !== 'EUR') fail('Valuta diversa da EUR: revisione richiesta.');
  if (!['processing', 'completed'].includes(order.status) || !order.date_paid) fail('Ordine non pagato o non pronto.');
  if (order.refunds?.length) fail('Ordine rimborsato: revisione richiesta.');
  if (order.fee_lines?.length) fail('Ordine con supplementi: revisione richiesta prima dell’invio.');
  const billing = address(order.billing);
  for (const key of ['first_name', 'last_name', 'address_1', 'postcode', 'city', 'country', 'email']) {
    if (!billing[key]) fail(`Anagrafica incompleta: ${key}.`);
  }
  if (billing.country === 'IT' && !billing.state) fail('Provincia di fatturazione mancante.');
  const customer = {
    externalId: String(order.customer_id || `guest:${order.id}`), billing,
    // Billing and shipping are intentionally separate; never replace billing with delivery data.
    shipping: address(order.shipping),
    vat: meta(order, ['p_iva', '_p_iva', 'billing_vat', '_billing_vat', 'billing_piva', '_billing_piva', 'partita_iva', 'billing_vat_number']),
    fiscalCode: meta(order, ['billing_cf', '_billing_cf', 'billing_codice_fiscale', '_billing_codice_fiscale', 'codice_fiscale']),
    pec: meta(order, ['billing_pec', '_billing_pec', 'pec']),
    sdi: meta(order, ['codice_univoco', 'billing_codice_univoco', 'billing_sdi', '_billing_sdi']),
    type: meta(order, ['tipologia', 'billing_tipologia']),
  };
  if (customer.type === 'azienda' && (!billing.company || !customer.vat)) fail('Azienda senza ragione sociale o partita IVA.');
  const lines = (order.line_items || []).map(item => {
    const quantity = decimal(item.quantity, 6) / 1e6;
    if (quantity <= 0 || !text(item.sku)) fail('Articolo senza SKU o quantità positiva.');
    const netCents = decimal(item.total), taxCents = decimal(item.total_tax || '0');
    const unitPrice = Math.round(netCents / 100 / quantity * 1e6) / 1e6;
    if (Math.round(unitPrice * quantity * 100) !== netCents) fail('Prezzo unitario non rappresentabile senza differenze.');
    const taxes = taxRows(item);
    if (sum(taxes.map(tax => tax.cents)) !== taxCents) fail('IVA della riga incoerente.');
    const sourceSku=text(item.sku),sku=resolveMexalSku(sourceSku,catalogSkuAliases);
    return { id: String(item.id), sku, ...(sku!==sourceSku?{sourceSku}:{}), name: text(item.name), quantity,
      unitPrice, netCents, taxCents, taxes, status: 'E', discount: '',
      sourceSubtotalCents: decimal(item.subtotal ?? item.total) };
  });
  if (!lines.length) fail('Ordine senza prodotti.');
  if (new Set(lines.map(line => line.id)).size !== lines.length) fail('ID righe duplicati.');
  const shipping = (order.shipping_lines || []).map(item => {
    const netCents=decimal(item.total),taxCents=decimal(item.total_tax||'0'),taxes=taxRows(item);
    // Woo may add an empty/zero rate to an existing free shipping row later.
    // Canonicalize only a verified zero row, preserving the original import hash.
    return {id:String(item.id),name:text(item.method_title),netCents,taxCents,taxes:netCents===0&&taxCents===0&&taxes.every(t=>t.cents===0)?[]:taxes};
  });
  for (const row of shipping) if (sum(row.taxes.map(tax => tax.cents)) !== row.taxCents) fail('IVA spedizione incoerente.');
  const shippingCents = sum(shipping.map(row => row.netCents));
  const taxCents = sum(lines.map(row => row.taxCents)) + sum(shipping.map(row => row.taxCents));
  const totalCents = sum(lines.map(row => row.netCents)) + shippingCents + taxCents;
  if (shippingCents !== decimal(order.shipping_total || '0')) fail('Totale spedizione incoerente.');
  if (sum(shipping.map(row => row.taxCents)) !== decimal(order.shipping_tax || '0')) fail('IVA spedizione diversa dal totale.');
  const sourceTotalCents=decimal(order.total),sourceTaxCents=decimal(order.total_tax||'0');
  if (!sameFirstDecimal(taxCents,sourceTaxCents)||!sameFirstDecimal(totalCents,sourceTotalCents)) fail('I totali dell’ordine non quadrano alla prima cifra decimale.');
  const date = text(order.date_created).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) fail('Data ordine non valida.');
  if (date.slice(0, 4) !== String(year)) fail('Anno dell’ordine diverso dall’esercizio configurato.');
  const plan = { version: 1, key: `${origin}|${company}|${year}|${order.id}`, reference: `SDI-WOO-${order.id}`, site: origin, company, year: String(year),
    orderId: String(order.id), orderNumber: text(order.number || order.id), date, customer, lines, shipping,
    shippingCents, taxCents, totalCents, causale: 2, paymentMethod: text(order.payment_method),
    ...(sourceTotalCents!==totalCents||sourceTaxCents!==taxCents?{sourceTotals:{totalCents:sourceTotalCents,taxCents:sourceTaxCents}}:{}) };
  return { ...plan, hash: createHash('sha256').update(JSON.stringify(plan)).digest('hex') };
}

export function documentPayload(plan, customerCode, config) {
  if (!customerCode || typeof config.module!=='string' || !/^[A-Z]?$/.test(config.module) || !Number.isInteger(config.series) || !Number.isInteger(config.warehouse)) fail('Configurazione documento incompleta.');
  const taxCode = line => {
    if (line.taxes.length !== 1) fail('IVA multipla o esente: serve una mappatura fiscale verificata.');
    const code = config.taxCodes?.[line.taxes[0].id];
    if (!code) fail(`Codice IVA Mexal non configurato per aliquota WooCommerce ${line.taxes[0].id}.`);
    return code;
  };
  // Mexal applies a header shipping tax policy. Mixed/exempt shipping must be verified separately.
  if (plan.shippingCents > 0) {
    if (!config.shippingTaxVerified) fail('Trattamento IVA spedizione Mexal non ancora verificato.');
    const codes = new Set(plan.shipping.filter(row => row.netCents > 0).map(taxCode));
    if (codes.size !== 1 || !codes.has(config.shippingTaxCode)) fail('IVA spedizione diversa dalla configurazione verificata.');
  }
  const rows = fn => plan.lines.map((line, i) => [i + 1, fn(line, i)]);
  const delivery=plan.customer.shipping.address_1?plan.customer.shipping:plan.customer.billing;
  const extra=config.addressMaxLength&&[delivery.address_1,delivery.address_2].filter(Boolean).join(', ').length>config.addressMaxLength?delivery.address_2:'';
  if(extra.length>64)fail('Indicazioni consegna troppo lunghe per i campi Mexal verificati.');
  const reference=plan.reference+(extra.length>30?` | Porto+: ${extra.slice(30)}`:'');
  if(reference.length>50)fail('Indicazioni consegna eccedono lo spazio disponibile nelle note OC.');
  return {
    sigla: 'OC', serie: config.series, numero: 0, cod_conto: customerCode,
    data_documento: plan.date.replaceAll('-', ''), cod_modulo: config.module,
    id_causale: [[1, 2]], id_magazzino: config.warehouse,
    ...(Number.isInteger(config.paymentCodes?.[plan.paymentMethod]) ? { id_pagamento: config.paymentCodes[plan.paymentMethod] } : {}),
    nota: [[1, reference]],
    ...(extra?{descr_porto:[[1,extra.slice(0,30)]]}:{}),
    tp_porto: [[1, plan.shippingCents ? 'D' : 'F']], tp_spese_sped: [[1, 'V']], val_spese_sped: [[1, euros(plan.shippingCents)]],
    id_riga: rows((_, i) => i + 1), tp_riga: rows(() => 'R'), codice_articolo: rows(line => line.sku),
    quantita: rows(line => line.quantity), prezzo: rows(line => Number(line.unitPrice.toFixed(config.priceDecimals??6))), sconto: rows(() => ''),
    id_mag_riga: rows(() => config.warehouse), tp_um_articolo: rows(() => '1'),
    cod_iva: rows(taxCode), tipo_stato_riga: rows(() => 'E'),
  };
}
