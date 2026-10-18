import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { isDeepStrictEqual } from 'node:util';
import { calculateLineConditions } from '../src/modules/orders/services/priceEngine.js';
import { calculateOrderEconomics, calculateOrderLineEconomicsWithPayment } from '../src/modules/orders/services/orderEconomics.js';
import { applyOrderVatPolicy, isForeignOrderCustomer } from '../src/modules/orders/services/orderVatPolicy.js';
import { applyOrderShipping, normalizeShippingConfig } from '../src/modules/orders/services/orderShipping.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = (message, status = 422) => Object.assign(new Error(message), { status });
async function result(query) { const { data, error } = await query;if (error) throw error;return data; }
async function all(db, table) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const batch = await result(db.from(table).select('*').eq('is_active', true).order('id').range(offset, offset + 999));
    rows.push(...batch);if (batch.length < 1000) return rows;
  }
}
export function supplyItems(value) {
  if (!Array.isArray(value) || value.length > 200) throw fail('Inserisci al massimo 200 prodotti.');
  const seen = new Set();
  return value.map(row => {
    if (!uuid.test(row?.product_id || '') || seen.has(row.product_id) || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 1000000) throw fail('Controlla prodotti e quantità: usa quantità intere da 1 a 1.000.000.');
    seen.add(row.product_id);return { product_id: row.product_id, quantity: row.quantity };
  }).sort((a, b) => a.product_id.localeCompare(b.product_id));
}
export function calculateSupplyQuote({ state, customer, agent, products, matrix, particulars, payments, shipping, items, moduleCode = 'prof', orderDate }) {
  const lines = items.map(item => {
    const product = products.find(p => p.id === item.product_id);
    if (!product) throw fail('Un prodotto non è più disponibile nel catalogo. Eliminalo e aggiorna il riepilogo.');
    const conditions = calculateLineConditions({ customer, product, quantity: item.quantity, discountMatrix: matrix, specialConditions: particulars, paymentRules: payments, orderDate });
    if (!(conditions.prezzo_listino > 0)) throw fail(`Prezzo di acquisto non disponibile per ${product.codice_mexal}. Contatta PROGRE'.`);
    if (!isForeignOrderCustomer(customer) && (!product.codice_iva_mexal || product.aliquota_iva == null || !Number.isFinite(Number(product.aliquota_iva)))) throw fail(`IVA non disponibile per ${product.codice_mexal}. Contatta PROGRE'.`);
    return calculateOrderLineEconomicsWithPayment(applyOrderVatPolicy({
      ...conditions, codice_articolo: product.codice_mexal, descrizione: product.nome, quantita: item.quantity,
      prezzo_listino: conditions.prezzo_base, aliquota_iva: product.aliquota_iva, codice_iva_mexal: product.codice_iva_mexal,
      dettaglio_calcolo: { ...conditions.dettaglio_calcolo, origine_club: true },
    }, customer));
  });
  const workspaceLines = applyOrderShipping(lines, shipping, { moduleCode });
  const totals = calculateOrderEconomics(workspaceLines);
  const canSend = Boolean(agent?.workspace_utente_id && agent.accesso_workspace_attivo && agent.attivo_mexal !== false);
  const quote = {
    store_code: state.store_code, store_name: customer.ragione_sociale, source_revision: state.revision,
    orders_count: state.orders_count, order_date: orderDate, module_code: moduleCode,
    agent_code: agent?.codice || null, agent_name: agent ? [agent.nome, agent.cognome].filter(Boolean).join(' ') || agent.codice : null,
    can_send: canSend, issue: canSend ? '' : 'Agente di riferimento non abilitato. Contatta PROGRE\' prima di inviare.',
    lines: lines.map((line, i) => ({ product_id: items[i].product_id, code: line.codice_articolo, name: line.descrizione,
      quantity: line.quantita, list_price: line.prezzo_listino, unit_price: line.prezzo_netto,
      commercial_discount: line.sconto_commerciale, payment_discount: line.sconto_pagamento,
      net_amount: line.imponibile_riga, vat: line.iva_riga, amount: line.totale_riga,
      requested_quantity: state.rows.find(p => p.product_id === items[i].product_id)?.quantity || 0 })),
    totals: { totale_imponibile: totals.totale_imponibile, totale_iva: totals.totale_iva, totale_documento: totals.totale_documento,
      shipping_net: workspaceLines.filter(l => l.riga_spedizione).reduce((sum, l) => sum + l.imponibile_riga, 0) },
  };
  return { quote, workspaceLines, shipping: normalizeShippingConfig(shipping) };
}
export async function runClubSupply({ db, actorId, input = {}, now = new Date() }) {
  const mode = input.mode || 'load';
  if (!['load', 'quote', 'submit'].includes(mode)) throw fail('Operazione non valida.', 400);
  if (mode === 'submit' && !uuid.test(input.request_key || '')) throw fail('Identificativo invio non valido.', 400);
  const state = await result(db.rpc('club_supply_state', { actor_id: actorId, request_key: mode === 'submit' ? input.request_key : null }));
  if (mode === 'submit' && state.existing) return { sent: state.existing };
  const customer = await result(db.from('ordini_clienti_cache').select('*').eq('codice_cliente', state.store_code).single());
  const agent = customer.codice_agente_mexal ? await result(db.from('mexal_agenti').select('codice,nome,cognome,workspace_utente_id,accesso_workspace_attivo,attivo_mexal').eq('codice', customer.codice_agente_mexal).maybeSingle()) : null;
  const classification = await result(db.from('crm_customer_classifications').select('area_crm').eq('codice_cliente', state.store_code).maybeSingle());
  const moduleCode = /farm|^ph$/i.test(classification?.area_crm || '') ? 'ph' : 'prof';
  const items = supplyItems(mode === 'load' ? state.rows.map(p => ({ product_id: p.product_id, quantity: p.quantity })) : input.items);
  const metadata = { pending: state.rows, orders_count: state.orders_count, source_revision: state.revision };
  async function compute() {
    const allowed = items.length ? await result(db.rpc('club_supply_allowed_products', { ids: items.map(i => i.product_id) })) : [];
    if (items.some(i => !allowed.includes(i.product_id))) throw fail('Un prodotto non è più ordinabile. Eliminalo e aggiorna il riepilogo.');
    const [base, matrix, particulars, payments, shippingRow] = await Promise.all([
      items.length ? result(db.from('prodotti').select('*').in('id', allowed)) : [],
      all(db, 'ordini_sconti_listini'), all(db, 'ordini_particolarita'), all(db, 'ordini_regole_pagamento'),
      result(db.from('ordini_moduli_configurazione').select('importo_minimo_porto_franco,addebito_spedizione').eq('modulo_ordini', moduleCode).maybeSingle()),
    ]);
    const codes = base.map(p => p.codice_mexal);
    const economics = codes.length ? await result(db.from('ordini_prodotti_cache').select('*').in('codice_articolo', codes)) : [];
    const products = base.map(p => ({ ...p, ...(economics.find(e => e.codice_articolo === p.codice_mexal) || {}), id: p.id, codice_mexal: p.codice_mexal, nome: p.nome }));
    return calculateSupplyQuote({ state, customer, agent, products, matrix, particulars, payments, shipping: shippingRow || {}, items, moduleCode,
      orderDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) });
  }
  let calculated;
  try { calculated = await compute(); } catch (error) { if (mode !== 'load' || !error.status) throw error;return { ...metadata, quote: null, quote_error: error.message }; }
  if (mode !== 'submit') return { ...metadata, quote: calculated.quote };
  if (!items.length || !calculated.quote.can_send) throw fail(calculated.quote.issue || 'Inserisci almeno un prodotto.');
  if (!isDeepStrictEqual(input.expected_quote, calculated.quote)) throw fail('Ordini, prezzi, condizioni o agente sono cambiati. Aggiorna il riepilogo e conferma i nuovi valori.', 409);
  if (typeof input.note !== 'string' || input.note.length > 2000) throw fail('La nota può contenere al massimo 2.000 caratteri.');
  const { quote, workspaceLines, shipping } = calculated;
  const header = { data_ordine: quote.order_date, modulo_ordini: moduleCode, ...quote.totals, ...shipping,
    partita_iva: customer.partita_iva || null, codice_pagamento: customer.codice_pagamento || null, codice_listino: customer.codice_listino || 1,
    descrizione_pagamento: customer.dati_mexal?._descrizione_pagamento || '',
    indirizzo_spedizione: [customer.indirizzo, customer.cap, customer.localita, customer.provincia].filter(Boolean).join(' '),
    commenti: `Ordine dal Club, inviato dal negozio all'agente di riferimento.\n${input.note.trim()}` };
  const sent = await result(db.rpc('club_commit_supply_order', { actor_id: actorId, request_key: input.request_key, payload: { quote, header, workspace_lines: workspaceLines } }));
  return { sent };
}
export async function handleClubSupply(req, res, injectedDb) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST');return res.status(405).json({ error: 'Metodo non consentito.' }); }
  try {
    const match = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
    if (!match) throw fail('Accedi come negozio per generare un ordine.', 401);
    const db = injectedDb || createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.auth.getUser(match[1]);
    if (error || !data?.user?.id) throw fail('Sessione non valida.', 401);
    return res.status(200).json(await runClubSupply({ db, actorId: data.user.id, input: req.body?.payload || {} }));
  } catch (error) {
    const status = error.code === '42501' ? 403 : error.code === '40001' ? 409 : error.status || 500;
    return res.status(status).json({ error: status >= 500 ? 'Generazione ordine temporaneamente non disponibile. Riprova.' : error.message });
  }
}
