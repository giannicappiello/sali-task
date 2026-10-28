import { prepareFifoLots } from './amazon-fifo.js';
import { sameFirstDecimal } from '../../shared/moneyFirstDecimal.js';
import { amazonCoxFinancials } from './amazon-tax.js';
// COX uses gross prices (verified against the existing COX document contract).
const text = value => String(value ?? '').trim();
const cents = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const scalar = value => Array.isArray(value) ? value[0]?.[1] : value;
export const AMAZON_CUSTOMER_CODE = '501.02156';
export const COX_RESOURCE = '/documenti/movimenti-magazzino';

export function verifyAmazonMoney(order,totalCents,taxCents) {
  const sourceTotalCents=cents(order.gross_revenue),netCents=cents(order.net_revenue);
  const sourceTaxCents=sourceTotalCents!==null && netCents!==null ? sourceTotalCents-netCents : null;
  assert(sameFirstDecimal(totalCents,sourceTotalCents) && sameFirstDecimal(taxCents,sourceTaxCents),
    'Totale/IVA Mexal diverso da Amazon alla prima cifra decimale: verificare il COX.');
  return {policy:'first_decimal',sourceTotalCents,mexalTotalCents:totalCents,sourceTaxCents,mexalTaxCents:taxCents,
    totalDifferenceCents:totalCents-sourceTotalCents,taxDifferenceCents:taxCents-sourceTaxCents};
}

export function amazonOrderDate(value) {
  assert(value && Number.isFinite(Date.parse(value)), 'Data ordine Amazon mancante o non valida.');
  // Business dates in Workspace/Mexal are Italian calendar dates, including DST.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return ['year','month','day'].map(key => parts.find(p => p.type === key).value).join('');
}

export function buildAmazonCox(order, lines, mappings, articles, customer) {
  const fiscal=amazonCoxFinancials(order,lines);
  order=fiscal.order;lines=fiscal.lines;
  assert(text(order.stato).toUpperCase() === 'SHIPPED', 'COX consentito solo per ordini Amazon interamente spediti.');
  assert(order.currency === 'EUR', 'Valuta Amazon diversa da EUR: verificare prima di emettere il COX.');
  assert(customer?.codice === AMAZON_CUSTOMER_CODE && text(customer.ragione_sociale).toUpperCase() === 'CLIENTE AMAZON', 'Anagrafica CLIENTE AMAZON non verificata.');
  assert(/^\d{3}-\d{7}-\d{7}$/.test(order.external_id), 'Numero ordine Amazon non valido.');
  assert(order.fulfilled_at && Number.isFinite(Date.parse(order.fulfilled_at)), 'Data effettiva di evasione Amazon non disponibile: COX non emesso.');
  assert(lines.length > 0, 'Ordine Amazon senza righe.');
  const gross = cents(order.gross_revenue);
  assert(gross > 0, 'Totale ordine Amazon non disponibile.');
  assert(cents(order.net_revenue) !== null && cents(order.net_revenue) >= 0, 'Imponibile/IVA definitivo Amazon non disponibile.');
  let total = 0;
  const prepared = lines.map(line => {
    const matches = mappings.filter(m => m.marketplace === order.marketplace && m.external_sku === line.external_sku && m.status === 'matched');
    assert(matches.length === 1 && matches[0].codice_mexal, `SKU ${line.external_sku}: associazione articolo mancante o ambigua.`);
    const code = text(matches[0].codice_mexal), article = articles.get(code);
    assert(article && text(article.codice) === code, `Articolo Mexal ${code} non verificato.`);
    assert(/^IT/i.test(code), `Articolo Amazon ${code} non ammesso.`);
    assert(Number.isInteger(Number(line.quantity)) && Number(line.quantity) > 0, `Quantità SKU ${line.external_sku} non valida.`);
    const revenue = cents(line.line_revenue);
    assert(revenue !== null && revenue >= 0, `Importo definitivo SKU ${line.external_sku} non disponibile.`);
    assert(text(article.alq_iva), `IVA articolo ${code} non disponibile.`);
    total += revenue;
    return { code, quantity: Number(line.quantity), price: Number((revenue / 100 / Number(line.quantity)).toFixed(4)), tax: fiscal.vatCode || text(article.alq_iva), lot: text(article.cod_tp_lotto) && article.gest_rich_lotto === 'S' };
  });
  // Never allocate an unknown difference to shipping or assume provisional prices.
  assert(total === gross, 'Totale righe Amazon diverso dal totale ordine: verificare spedizione, sconti e imposte.');
  const matrix = key => prepared.map((line, index) => [index + 1, line[key]]);
  return {
    sigla: 'CO', cod_modulo: 'X', serie: 1, numero: 0, cod_conto: AMAZON_CUSTOMER_CODE,
    data_documento: amazonOrderDate(order.fulfilled_at), id_causale: [[1, 2]], id_magazzino: 4, id_magazzino_a: 0,
    nota: [[1, order.external_id]], id_pagamento: Number(customer.cod_pagamento) || 4,
    codice_agente: text(customer.cod_agente), acconto_pagato: gross / 100,
    tp_porto: [[1, 'F']], tp_spese_sped: [[1, 'V']], val_spese_sped: [[1, 0]],
    id_riga: prepared.map((_, index) => [index + 1, 0]),
    tp_riga: prepared.map((_, index) => [index + 1, 'R']),
    codice_articolo: matrix('code'), quantita: matrix('quantity'), prezzo: matrix('price'), cod_iva: matrix('tax'),
    id_mag_da_riga: prepared.map((_, index) => [index + 1, 4]),
    tp_um_articolo: prepared.map((_, index) => [index + 1, '1']),
    sconto: prepared.map((_, index) => [index + 1, '']),
    id_lotto: [],
    qta_lotto: [],
  };
}

export function verifyAmazonCox(actual, payload, order) {
  assert(actual.sigla === 'CO' && actual.cod_modulo === 'X', 'Documento Mexal diverso da COX.');
  assert(Number(actual.numero) > 0 && Number(actual.serie) === payload.serie, 'Numero/serie COX non verificati.');
  for (const key of ['cod_conto','data_documento','id_magazzino']) assert(text(actual[key]) === text(payload[key]), `COX diverso: ${key}.`);
  const note = text(scalar(actual.nota));
  assert(new RegExp(`(^|[^0-9-])${order.external_id}($|[^0-9-])`).test(note), 'Riferimento ordine Amazon non verificato nelle note COX.');
  for (const key of ['codice_articolo','quantita','prezzo','id_mag_da_riga',...(order.raw_summary?.tax_collection?['cod_iva']:[])]) {
    assert(Array.isArray(actual[key]) && actual[key].length === payload[key].length, `Righe COX diverse: ${key}.`);
    const values = new Map(actual[key]);
    for (const [index, value] of payload[key]) {
      const equal=key==='prezzo'?Math.abs(Number(values.get(index))-value)<0.000001:
        key==='cod_iva'?text(values.get(index)).toUpperCase().replace(/[,.]0+$/,'')===text(value).toUpperCase().replace(/[,.]0+$/,''):
          text(values.get(index))===text(value);
      assert(equal,`Righe COX diverse: ${key}.`);
    }
  }
  if(payload.id_lotto?.length) for(const key of ['id_lotto','qta_lotto','pos_righe_lotto','nr_righe_lotto']) {
    assert(Array.isArray(actual[key]) && actual[key].length===payload[key].length, 'Lotti COX diversi: '+key);
    const values=new Map(actual[key]);
    for(const [index,value] of payload[key]) assert(Number(values.get(index))===Number(value), 'Lotti COX diversi: '+key);
  }
  const fiscal=amazonCoxFinancials(order);
  // Mexal represents a verified N41 document's zero VAT with an empty matrix.
  const actualTax=fiscal.vatCode==='N41' && Array.isArray(actual.tot_iva) && actual.tot_iva.length===0?0:cents(scalar(actual.tot_iva));
  const moneyVerification=verifyAmazonMoney(fiscal.order,cents(scalar(actual.tot_documento)),actualTax);
  return { year: payload.data_documento.slice(0,4), series: Number(actual.serie), number: Number(actual.numero), date: payload.data_documento,
    ...(moneyVerification.totalDifferenceCents || moneyVerification.taxDifferenceCents ? {moneyVerification} : {}),
    ...(fiscal.proof?{taxTreatment:fiscal.proof}:{}) };
}

async function checked(result) { if (result.error) throw result.error; return result.data; }

async function existingCox(mexal, order) {
  const matches = [], seen = new Set(); let next;
  do {
    const query = new URLSearchParams({ max: '100' }); if (next) query.set('next', next);
    const page = await mexal.postJson(`${COX_RESOURCE}/ricerca?${query}`, { filtri: [
      { campo: 'sigla', condizione: '=', valore: 'CO' }, { campo: 'cod_modulo', condizione: '=', valore: 'X' },
      { campo: 'cod_conto', condizione: '=', valore: AMAZON_CUSTOMER_CODE }, { campo: 'nota', condizione: 'contiene', valore: order.external_id },
    ] });
    assert(Array.isArray(page.dati), 'Ricerca COX incompleta.');
    matches.push(...page.dati.filter(row => !text(scalar(row.nota)).includes('RESO:') && new RegExp(`(^|[^0-9-])${order.external_id}($|[^0-9-])`).test(text(scalar(row.nota)))));
    next = page.next; assert(!next || !seen.has(next), 'Cursore ricerca COX ripetuto.'); seen.add(next);
    assert(seen.size <= 50, 'Ricerca COX troppo estesa.');
  } while (next);
  assert(matches.length <= 1, 'Più COX riportano lo stesso numero ordine Amazon.');
  return matches[0];
}

async function prepareAmazonCox(db,connection,order,mexal) {
    const customer = await mexal.getJson(`/clienti/${AMAZON_CUSTOMER_CODE}`);
    const lines = await checked(await db.from('crm_external_order_lines').select('external_line_id,external_sku,quantity,line_revenue').eq('order_id', order.id).order('external_line_id').limit(1001));
    assert(lines.length <= 1000, 'Ordine con troppe righe per una singola emissione.');
    const skus = [...new Set(lines.map(l => l.external_sku))];
    const mappings = skus.length ? await checked(await db.from('crm_product_mappings').select('external_sku,marketplace,status,codice_mexal').eq('connection_id', connection.id).eq('marketplace', order.marketplace).in('external_sku', skus).limit(1001)) : [];
    const articles = new Map();
    for (const code of new Set(mappings.filter(m => m.status === 'matched').map(m => m.codice_mexal).filter(Boolean))) articles.set(code, await mexal.getJson(`/articoli/${encodeURIComponent(code)}`));
    return {payload:buildAmazonCox(order, lines, mappings, articles, customer),articles,financialOrder:amazonCoxFinancials(order,lines).order};
}

export function createdCoxReference(created) {
  const row = Array.isArray(created?.dati) ? created.dati[0] : created?.dati || created;
  const number = Number(row?.numero), series = Number(row?.serie || 1);
  if (Number.isSafeInteger(number) && number > 0 && Number.isSafeInteger(series) && series > 0) return {number,series};
  const headers = created?.mexalHttpResponse?.headers || {};
  const location = Object.entries(headers).find(([key])=>key.toLowerCase()==='location')?.[1];
  if (!location) return null;
  let path;
  try { path=decodeURIComponent(new URL(String(location),'https://mexal.invalid').pathname); } catch {return null;}
  const match = /\/documenti\/movimenti-magazzino\/CO\+(\d+)\+(\d+)\+501\.02156$/.exec(path);
  if (!match || Number(match[1])<=0 || Number(match[2])<=0) return null;
  return {series:Number(match[1]),number:Number(match[2])};
}

export async function reconcileAmazonCox({db,connection,order,clientForYear}) {
  // Mexal is read-only here: uncertainty must never cause a second document POST.
  const delivery=await checked(await db.from('crm_amazon_cox_exports').select('token,status').eq('amazon_order_id',order.external_id).single());
  if (delivery.status!=='reconciliation_required') return {status:'skipped'};
  try {
    const date=amazonOrderDate(order.fulfilled_at),mexal=clientForYear(date.slice(0,4));
    const {payload}=await prepareAmazonCox(db,connection,order,mexal);
    const existing=await existingCox(mexal,order);
    if (!existing) return {status:'reconciliation_required',error:'COX non ancora trovato: nessuna nuova emissione.'};
    const actual=await mexal.getJson(`${COX_RESOURCE}/CO+${Number(existing.serie)}+${Number(existing.numero)}+${AMAZON_CUSTOMER_CODE}`);
    const reference=verifyAmazonCox(actual,payload,order);
    await checked(await db.rpc('crm_finish_amazon_cox_service',{p_order_id:order.id,p_token:delivery.token,p_status:'emitted',p_reference:reference,p_error:null}));
    return {status:'emitted',reference,reconciled:true};
  } catch(error) {return {status:'reconciliation_required',error:String(error.message).slice(0,500)};}
}

export async function emitAmazonCox({ db, connection, order, clientForYear }) {
  const claim = await checked(await db.rpc('crm_claim_amazon_cox_service', { p_order_id: order.id }));
  if (!claim) return { status: 'skipped' };
  let writeStarted = false, knownReference = null;
  const complete = async (status, reference = null, error = null) => checked(await db.rpc('crm_finish_amazon_cox_service', {
    p_order_id: order.id, p_token: claim, p_status: status, p_reference: reference, p_error: error,
  }));
  try {
    const date = amazonOrderDate(order.fulfilled_at), mexal = clientForYear(date.slice(0,4));
    const prepared = await prepareAmazonCox(db,connection,order,mexal);
    let payload = prepared.payload;
    const existing = await existingCox(mexal, order);
    let actual;
    if (existing) {
      writeStarted = true; // Existing documents require reconciliation if their content differs.
      knownReference = { year:date.slice(0,4), series:Number(existing.serie), number:Number(existing.numero), date };
      actual = await mexal.getJson(`${COX_RESOURCE}/CO+${Number(existing.serie)}+${Number(existing.numero)}+${AMAZON_CUSTOMER_CODE}`);
    }
    else {
      payload = await prepareFifoLots(mexal,payload,prepared.articles);
      const calculated = await mexal.calculateDocument(payload);
      const calculatedNet=cents(calculated.tot_imponibile),calculatedTax=cents(calculated.tot_imposta);
      assert(calculatedNet!==null && calculatedTax!==null, 'Totale/IVA preventivo Mexal non disponibile: COX non emesso.');
      verifyAmazonMoney(prepared.financialOrder,calculatedNet+calculatedTax,calculatedTax);
      // A persisted processing claim is never automatically reclaimed after process death.
      // Mark uncertainty before POST, since the server may commit and lose its response.
      writeStarted = true;
      const created = await mexal.postJson(COX_RESOURCE, payload);
      const returned = createdCoxReference(created);
      let number = returned?.number, series = returned?.series;
      if (!number) {
        const found = await existingCox(mexal, order);
        assert(found, 'COX inviato: riferimento da riconciliare.'); number = Number(found.numero); series = Number(found.serie);
      }
      knownReference = { year:date.slice(0,4), series, number, date };
      actual = await mexal.getJson(`${COX_RESOURCE}/CO+${series}+${number}+${AMAZON_CUSTOMER_CODE}`);
    }
    const reference = verifyAmazonCox(actual, payload, order);
    await complete('emitted', reference);
    return { status: 'emitted', reference };
  } catch (error) {
    const status = writeStarted ? 'reconciliation_required' : 'blocked';
    await complete(status, knownReference, String(error.message).slice(0,500));
    return { status, error: String(error.message).slice(0,500) };
  }
}

// Export is a separate bounded phase after import. It also revisits older shipped
// orders after their mappings are completed; it never depends on provider deltas.
export async function synchronizeAmazonCox({ db, connection, clientForYear, batchSize = 2 }) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(connection.amazon_cox_from || ''), 'Configurare la data iniziale COX Amazon dopo aver riconciliato i corrispettivi storici.');
  const state = connection.amazon_cox_state || {};
  if ((state.phase || (state.after ? 'emit' : 'reconcile'))==='reconcile') {
    let recover=db.from('crm_external_orders').select('id,external_id,marketplace,stato,ordered_at,currency,gross_revenue,net_revenue,fulfilled_at,raw_summary').eq('connection_id',connection.id).eq('cox_status','reconciliation_required').order('id').limit(batchSize+1);
    if(state.after) recover=recover.gt('id',state.after);
    const rows=await checked(await recover),batch=rows.slice(0,batchSize),results=[];
    for(const order of batch) results.push({orderId:order.id,...await reconcileAmazonCox({db,connection,order,clientForYear})});
    await checked(await db.from('crm_external_connections').update({amazon_cox_state:rows.length>batchSize ? {active:true,phase:'reconcile',after:batch.at(-1).id} : {active:true,phase:'emit'}}).eq('id',connection.id));
    return {hasMore:true,results,emitted:results.filter(row=>row.status==='emitted').length,failed:results.filter(row=>row.status==='reconciliation_required').length};
  }
  let query = db.from('crm_external_orders').select('id,external_id,marketplace,stato,ordered_at,currency,gross_revenue,net_revenue,fulfilled_at,raw_summary')
    .eq('connection_id', connection.id).ilike('stato', 'shipped').in('cox_status', ['pending','blocked'])
    .not('fulfilled_at','is',null).gte('fulfilled_at', new Date(Date.parse(`${connection.amazon_cox_from}T00:00:00Z`) - 7200000).toISOString())
    .order('id').limit(batchSize + 1);
  if (state.after) query = query.gt('id', state.after);
  // The cutoff is an Italian order date, not a UTC timestamp or shipment date.
  const orders = await checked(await query), batch = orders.slice(0,batchSize), results = [];
  for (const order of batch) {
    if (amazonOrderDate(order.fulfilled_at) < connection.amazon_cox_from.replaceAll('-','')) continue;
    results.push({ orderId: order.id, ...await emitAmazonCox({ db, connection, order, clientForYear }) });
  }
  const hasMore = orders.length > batchSize;
  await checked(await db.from('crm_external_connections').update({ amazon_cox_state: hasMore ? { active: true, phase:'emit', after: batch.at(-1).id } : {} }).eq('id', connection.id));
  return { hasMore, results, emitted: results.filter(r => r.status === 'emitted').length, failed: results.filter(r => ['blocked','reconciliation_required'].includes(r.status)).length };
}
