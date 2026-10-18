import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateSupplyQuote, handleClubSupply, runClubSupply, supplyItems } from '../server/club-supply-orders.js';
process.env.CLUB_OFFER_FIXTURE_ONLY = '1';
const { createOfferFixture, id } = await import('./club-store-offers.test.mjs');

// Real PostgreSQL is used behind the same query interface as the server SDK.
function transport(db) {
  return {
    async rpc(name, args) {
      try { const keys = Object.keys(args), values = Object.values(args);const rows = (await db.query(`select public.${name}(${keys.map((key, i) => `${key}=>$${i + 1}`).join(',')}) value`, values)).rows;return { data: rows[0].value }; } catch (error) { return { error }; }
    },
    from(table) {
      const filters = [], values = [], orders = [];let columns = '*', offset = 0, limit = null, single = false;
      const q = { select(c) { columns = c;return q; }, eq(k, v) { values.push(v);filters.push(`${k}=$${values.length}`);return q; },
        in(k, v) { const placeholders = v.map(x => { values.push(x);return '$' + values.length; });filters.push(`${k} in (${placeholders.join(',')})`);return q; },
        order(k) { orders.push(k);return q; }, range(a, b) { offset = a;limit = b - a + 1;return q; }, single() { single = true;return q; }, maybeSingle() { single = true;return q; },
        then(resolve, reject) { return db.query(`select ${columns} from ${table}${filters.length ? ' where ' + filters.join(' and ') : ''}${orders.length ? ' order by ' + orders.join(',') : ''}${limit == null ? '' : ` limit ${limit} offset ${offset}`}`, values).then(r => resolve({ data: single ? r.rows[0] || null : r.rows }), reject); },
      };return q;
    },
  };
}
async function fixture() {
  const db = await createOfferFixture();
  await db.exec(`reset role;
  alter table ordini_clienti_cache add column if not exists codice_agente_mexal text,add column if not exists codice_listino integer default 1,add column if not exists codice_pagamento integer default 1,add column if not exists categoria_sconti integer default 10,add column if not exists paese text default 'IT',add column if not exists partita_iva text,add column if not exists localita text,add column if not exists dati_mexal jsonb default '{}';
  update ordini_clienti_cache set codice_agente_mexal=case when codice_cliente='A' then 'AG1' else 'AG2' end;
  alter table mexal_agenti add column nome text,add column cognome text,add column accesso_workspace_attivo boolean default true;
  insert into mexal_agenti(codice,nome,cognome,workspace_utente_id,accesso_workspace_attivo,attivo_mexal) values('AG1','Anna','Agente','${id(1)}',true,true),('AG2','Altro','Agente','${id(1)}',true,true);
  create table crm_customer_classifications(codice_cliente text,area_crm text);insert into crm_customer_classifications values('A','b2b'),('B','b2b');
  create table ordini_prodotti_cache(codice_articolo text,prezzo_listino numeric,categoria_sconto integer,aliquota_iva numeric,codice_iva_mexal text);
  insert into ordini_prodotti_cache values('IT0492',100,1,22,'22'),('IT-TEST-51',50,2,22,'22'),('IT-TEST-52',20,2,22,'22');
  create table ordini_sconti_listini(id bigint,is_active boolean,cod_cat_cli integer,cod_cat_art integer,sconto text);
  insert into ordini_sconti_listini values(1,true,10,1,'30'),(2,true,10,2,'50');
  create table ordini_particolarita(id bigint,is_active boolean);
  create table ordini_regole_pagamento(id bigint,is_active boolean,codice_pagamento text,sconto text);insert into ordini_regole_pagamento values(1,true,'1','10');
  create table ordini_moduli_configurazione(modulo_ordini text,importo_minimo_porto_franco numeric,addebito_spedizione numeric);insert into ordini_moduli_configurazione values('prof',300,10);
  create table ordini_testate(id uuid primary key,codice_cliente text,ragione_sociale_cliente text,codice_agente_mexal text,data_ordine date,stato text,modulo_ordini text,commenti text,partita_iva text,codice_pagamento integer,descrizione_pagamento text,codice_listino integer,indirizzo_spedizione text,totale numeric,totale_imponibile numeric,totale_iva numeric,totale_documento numeric,importo_minimo_porto_franco numeric,addebito_spedizione numeric,numero_ordine_visualizzato text default 'W/TEST');
  create table ordini_righe(ordine_id uuid,codice_articolo text,descrizione text,quantita numeric,prezzo_listino numeric,prezzo_netto numeric,sconto_percentuale numeric,sconto_commerciale text,sconto_pagamento text,origine_prezzo text,origine_sconto text,regola_prezzo_id bigint,regola_sconto_id bigint,regola_pagamento_id bigint,dettaglio_calcolo jsonb,codice_iva_mexal text,aliquota_iva numeric,imponibile_riga numeric,iva_riga numeric,totale_riga numeric,riga_spedizione boolean,riga_descrittiva boolean,iva_non_applicata boolean);
  create table notifiche(id uuid default gen_random_uuid(),utente_id uuid,titolo text,messaggio text,tipo text,evento text,url text,link text,metadata jsonb);
  `);
  for (const name of ['20261018150000_salidischia_club_customer_orders.sql','20261018160000_salidischia_club_supply_orders.sql']) await db.exec(await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
  return db;
}
if (!process.env.CLUB_SUPPLY_FIXTURE_ONLY) test('Dealer generates a priced supplier order, atomically routes it to its agent and consumes source quantities once', async () => {
  const db = await fixture(), q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const actor = async n => db.exec(`reset role;set request.jwt.claim.sub='${id(n)}';set test.auth='${id(n)}';set role authenticated;`);
  const order = async (n, items, key) => { await actor(n);const quote = (await q('select club_quote_order($1) value', [items]))[0].value;return (await q('select club_send_order($1,$2,$3) value', [items, id(key), quote]))[0].value; };
  try {
    await order(2, [{ product_id: id(50), quantity: 2 }, { product_id: id(51), quantity: 1 }], 951);
    await actor(3);await q("select club_select_store('A')");await order(3, [{ product_id: id(50), quantity: 3 }, { product_id: id(52), quantity: 2 }], 952);
    await actor(4);await assert.rejects(q('select club_supply_state($1)', [id(4)]), /permission denied/);await assert.rejects(q('select club_commit_supply_order($1,$2,$3)', [id(4), id(960), {}]), /permission denied/);
    await assert.rejects(q('select * from club_supply_orders'), /permission denied/);await assert.rejects(q('select * from ordini_clienti_cache where codice_cliente=\'B\''), /permission denied/);
    await db.exec('reset role');const api = transport(db), run = input => runClubSupply({ db: api, actorId: id(4), input });
    const loaded = await run({ mode: 'load' });assert.equal(loaded.orders_count, 2);assert.equal(loaded.pending.find(p => p.product_id === id(50)).quantity, 5);assert.equal(loaded.quote.agent_name, 'Anna Agente');assert.equal(loaded.quote.lines.find(p => p.product_id === id(50)).unit_price, 63);
    const items = [{ product_id: id(50), quantity: 4 }, { product_id: id(52), quantity: 3 }];
    let quoted = await run({ mode: 'quote', items });assert.equal(quoted.quote.totals.totale_imponibile, 289);assert.equal(quoted.quote.totals.totale_documento, 352.58);
    const input = { mode: 'submit', items, expected_quote: quoted.quote, request_key: id(960), note: 'Consegna prossima settimana' };
    await assert.rejects(run({ ...input, expected_quote: { ...quoted.quote, agent_code: 'AG2' } }), /cambiati/);
    await q("update ordini_sconti_listini set sconto='40' where id=1");await assert.rejects(run(input), /cambiati/);await q("update ordini_sconti_listini set sconto='30' where id=1");
    await db.exec(`create function reject_test_notification() returns trigger language plpgsql as $$begin raise exception 'Notification failure';end$$;create trigger reject_test_notification before insert on notifiche for each row execute function reject_test_notification();`);
    await assert.rejects(run(input), /Notification failure/);
    assert.equal((await q('select count(*)::int n from ordini_testate'))[0].n, 0);assert.equal((await q('select count(*)::int n from club_supply_allocations'))[0].n, 0);
    await db.exec('drop trigger reject_test_notification on notifiche;drop function reject_test_notification()');
    const sent = await run(input);assert.equal(sent.sent.number, 'W/TEST');assert.equal(sent.sent.agent_name, 'Anna Agente');
    assert.deepEqual((await run({ ...input, expected_quote: null })).sent, sent.sent);
    assert.equal((await q('select count(*)::int n from ordini_testate'))[0].n, 1);assert.equal((await q('select count(*)::int n from notifiche'))[0].n, 1);
    const header = (await q('select * from ordini_testate'))[0];assert.equal(header.codice_agente_mexal, 'AG1');assert.equal(header.codice_cliente, 'A');assert.equal(header.stato, 'bozza');assert.equal(header.totale_documento, '352.58');
    assert.ok(header.commenti.includes('Consegna prossima settimana'));assert.equal((await q('select * from ordini_righe where riga_spedizione'))[0].imponibile_riga, '10');
    const pending = await run({ mode: 'load' });assert.equal(pending.pending.find(p => p.product_id === id(50)).quantity, 1);assert.equal(pending.pending.find(p => p.product_id === id(51)).quantity, 1);assert.equal(pending.pending.some(p => p.product_id === id(52)), false);
    await assert.rejects(run({ ...input, request_key: id(961) }), /cambiati/);
    // A source change while a commercial preview is open forces reconfirmation.
    const fresh = { mode: 'submit', items: pending.pending.map(p => ({ product_id: p.product_id, quantity: p.quantity })), expected_quote: pending.quote, request_key: id(962), note: '' };
    await order(2, [{ product_id: id(50), quantity: 1 }], 953);await db.exec('reset role');await assert.rejects(run(fresh), /cambiati/);
    // Orders stay owned by the original store even after a customer moves.
    await actor(2);await q("select club_select_store('B')");await actor(5);assert.deepEqual((await q('select club_supply_history() value'))[0].value, []);
    await actor(4);assert.equal((await q('select club_supply_history() value'))[0].value.length, 1);
    await db.exec('reset role');await q("update ordini_testate set stato='annullato' where id=$1", [sent.sent.workspace_order_id]);
    assert.equal((await run({ mode: 'load' })).pending.find(p => p.product_id === id(50)).quantity, 6);
    await q('update club_store_users set active=false where auth_user_id=$1', [id(4)]);await assert.rejects(run({ mode: 'load' }), /negozio non attivo/);
  } finally { await db.close(); }
});
if (!process.env.CLUB_SUPPLY_FIXTURE_ONLY) test('Order validation rejects tampering and unauthenticated access before reading commercial data', async () => {
  for (const items of [[{ product_id: id(50), quantity: 0 }], [{ product_id: id(50), quantity: 1.5 }], [{ product_id: 'bad', quantity: 1 }], [{ product_id: id(50), quantity: 1 }, { product_id: id(50), quantity: 2 }]]) assert.throws(() => supplyItems(items));
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n;return this; }, json(v) { this.body = v;return this; } };
  await handleClubSupply({ method: 'POST', headers: {}, body: {} }, res, {});assert.equal(res.code, 401);assert.equal(res.headers['Cache-Control'], 'private, no-store');
  await handleClubSupply({ method: 'GET', headers: {} }, res, {});assert.equal(res.code, 405);
});

export { fixture as createSupplyFixture, transport as supplyTransport, id };

if (!process.env.CLUB_SUPPLY_FIXTURE_ONLY) test('Reserved purchase prices use customer-specific price and discount rules, payment discounts and foreign VAT policy', () => {
  const product = { id: id(50), codice_mexal: 'IT0492', nome: 'Crema', prezzo_listino: 100, categoria_sconto: 1, aliquota_iva: 22, codice_iva_mexal: '22' };
  const options = { state: { store_code: 'A', revision: 'r', rows: [], orders_count: 0 }, customer: { codice_cliente: 'A', codice_pagamento: '1', categoria_sconti: 10 }, agent: null,
    products: [product], items: [{ product_id: id(50), quantity: 1 }], matrix: [{ cod_cat_cli: 10, cod_cat_art: 1, sconto: '30' }],
    payments: [{ codice_pagamento: '1', sconto: '10' }], shipping: {}, orderDate: '2026-10-18',
    particulars: [{ id: 1, is_active: true, tipo_part: 'P', tp_dato_conto: 'C', codice_conto: 'A', tp_dato_art: 'A', cod_articolo: 'IT0492', prezzo: 40 }] };
  let quote = calculateSupplyQuote(options).quote;assert.equal(quote.lines[0].list_price, 40);assert.equal(quote.lines[0].unit_price, 36);assert.equal(quote.lines[0].commercial_discount, '');
  quote = calculateSupplyQuote({ ...options, customer: { ...options.customer, codice_cliente: 'B' } }).quote;assert.equal(quote.lines[0].unit_price, 63);
  const discount = { ...options.particulars[0], tipo_part: 'S', sconto: '60+20' };
  quote = calculateSupplyQuote({ ...options, particulars: [discount] }).quote;assert.equal(quote.lines[0].unit_price, 28.8);
  quote = calculateSupplyQuote({ ...options, customer: { ...options.customer, paese: 'FR' }, products: [{ ...product, aliquota_iva: null, codice_iva_mexal: null }] }).quote;
  assert.equal(quote.totals.totale_iva, 0);assert.equal(quote.totals.totale_documento, 36);
});
