import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Run against disposable embedded PostgreSQL, never production.
// Install @electric-sql/pglite in a test runtime, or set PGLITE_MODULE to its file URL.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/20261104100000_customer_warehouse_supplier_name.sql', import.meta.url), 'utf8');
const baseline = await readFile(new URL('../migrations/20261021163000_warehouse_dashboard_timeout_fix.sql', import.meta.url), 'utf8');

test('customer warehouse includes suppliers by business name with independent Mexal codes', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create role anon;
      create role authenticated;
      create function auth.role() returns text language sql stable as
        $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
      create function public.workspace_current_customer_codes() returns text[] language sql stable as
        $$ select coalesce(array(select jsonb_array_elements_text(coalesce(nullif(current_setting('test.customers', true), ''), '[]')::jsonb)), '{}'::text[]) $$;
      create function public.workspace_current_customer_code() returns text language sql stable as
        $$ select (public.workspace_current_customer_codes())[1] $$;
      create table public.ordini_clienti_cache(codice_cliente text primary key, ragione_sociale text);
      create table public.ordini_testate(id int primary key, codice_cliente text);
      create table public.ordini_righe(ordine_id int, codice_articolo text);
      create table public.mexal_fatture_vendita(id int primary key, codice_cliente text);
      create table public.mexal_fatture_vendita_righe(fattura_id int, codice_articolo text);
      create table public.ordini_prodotti_cache(codice_articolo text primary key, descrizione text, unita_misura text, mostra_in_app boolean);
      create table public.workspace_article_supplier_associations(article_code text, supplier_code text, supplier_name text, source text);
      create table public.workspace_warehouse_stock_history(
        snapshot_date date, article_code text, warehouse_number int, warehouse_name text,
        unit_of_measure text, on_hand numeric, committed numeric, available numeric,
        unit_cost numeric, source text, captured_at timestamptz);
      insert into ordini_clienti_cache values
        ('501.00001', 'ACME Srl'), ('501.00002', 'Beta Srl'), ('501.00003', 'Other Srl'),
        ('501.00004', '   '), ('501.00005', null);
      insert into ordini_prodotti_cache values
        ('MP-SUPPLIER', 'Supplier only', 'KG', true),
        ('MP-ORDER', 'Order only', 'KG', true),
        ('MP-INVOICE', 'Invoice only', 'KG', true),
        ('MP-BOTH', 'Multiple qualifying relationships', 'KG', true),
        ('MP-BETA', 'Second linked customer', 'KG', true),
        ('MP-OTHER', 'Unlinked customer', 'KG', true),
        ('MP-SUBSTRING', 'Substring must not match', 'KG', true),
        ('MP-CODE', 'Matching code but different name', 'KG', true),
        ('MP-HIDDEN', 'Catalog hidden', 'KG', false),
        ('MP-LEGACY', 'Historical association', 'KG', true),
        ('MP-MANUAL', 'Manual association', 'KG', true),
        ('MP-BLANK', 'Blank name', 'KG', true);
      insert into workspace_article_supplier_associations values
        ('mp-supplier', '601.00999', E'  acme\\t  SRL  ', 'MEXAL_ARTICLE_MASTER_V1'),
        ('MP-SUPPLIER', '601.00888', 'ACME Srl', 'MEXAL_ARTICLE_MASTER_V1'),
        ('MP-BOTH', '601.00777', 'ACME Srl', 'MEXAL_ARTICLE_MASTER_V1'),
        ('MP-BETA', '601.00222', 'Beta Srl', 'MEXAL_ARTICLE_MASTER_V1'),
        ('MP-OTHER', '601.00333', 'Other Srl', 'MEXAL_ARTICLE_MASTER_V1'),
        ('MP-SUBSTRING', '601.00444', 'ACME Srl Holding', 'MEXAL_ARTICLE_MASTER_V1'),
        ('MP-CODE', '501.00001', 'Other Srl', 'MEXAL_ARTICLE_MASTER_V1'),
        ('MP-HIDDEN', '601.00999', 'ACME Srl', 'MEXAL_ARTICLE_MASTER_V1'),
        ('MP-NOT-IN-CATALOG', '601.00999', 'ACME Srl', 'MEXAL_ARTICLE_MASTER_V1'),
        ('MP-LEGACY', '601.00999', 'ACME Srl', 'MEXAL_ORDER_HISTORY'),
        ('MP-MANUAL', '601.00999', 'ACME Srl', 'MANUAL'),
        ('MP-BLANK', '601.00999', '   ', 'MEXAL_ARTICLE_MASTER_V1');
      insert into ordini_testate values (1, '501.00001'), (2, '501.00003');
      insert into ordini_righe values (1, 'MP-ORDER'), (1, 'MP-BOTH'), (2, 'MP-OTHER');
      insert into mexal_fatture_vendita values (1, '501.00001'), (2, '501.00003');
      insert into mexal_fatture_vendita_righe values (1, 'MP-INVOICE'), (1, 'MP-BOTH'), (2, 'MP-OTHER');
      insert into workspace_warehouse_stock_history
        select date '2026-11-03', codice_articolo, 1, 'Warehouse 1', 'KG', 4, 1, 3, 25, 'mexal', timestamptz '2026-11-03 12:00Z'
        from ordini_prodotti_cache;
      insert into workspace_warehouse_stock_history values
        ('2026-11-04', 'MP-SUPPLIER', 1, 'Warehouse 1', 'KG', 10, 2, 8, 25, 'mexal', '2026-11-04 12:00Z'),
        ('2026-11-03', 'MP-SUPPLIER', 8, 'Warehouse 8', 'KG', 20, 3, 17, 25, 'mexal', '2026-11-03 12:00Z'),
        ('2026-11-04', 'MP-SUPPLIER', 8, 'Warehouse 8', 'KG', 20, 3, 17, 25, 'mexal', '2026-11-04 12:00Z');
    `);
    const scope = async (codes) => db.query("select set_config('test.customers', $1, false)", [JSON.stringify(codes)]);
    const dashboard = async ({ day = '2026-11-04', warehouse = null, type = null, unit = null, query = null, stock = 'all', limit = 100, offset = 0 } = {}) =>
      (await db.query('select public.workspace_warehouse_dashboard($1::date,$2::integer,$3,$4,$5,$6,$7::integer,$8::integer) result',
        [day, warehouse, type, unit, query, stock, limit, offset])).rows[0].result;
    const codes = (result) => result.rows.map((r) => r.article_code).sort();

    await db.exec(baseline);
    // CREATE OR REPLACE must retain the installed function's grants.
    await db.exec(`revoke execute on function public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer) from public;
      grant execute on function public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer) to authenticated;`);
    const internalBefore = await dashboard();
    await scope(['501.00001']);
    const before = await dashboard();
    assert.deepEqual(codes(before), ['MP-BOTH', 'MP-INVOICE', 'MP-ORDER']);
    await db.exec(migration);

    await t.test('adds supplier-only articles by exact normalized name, independent of account code', async () => {
      const result = await dashboard();
      assert.deepEqual(codes(result), ['MP-BOTH', 'MP-INVOICE', 'MP-ORDER', 'MP-SUPPLIER']);
      assert.equal(result.totalRows, 4);
      assert.equal(result.summary.articles, 4);
      assert.equal(result.rows.find((r) => r.article_code === 'MP-SUPPLIER').on_hand, 30);
    });
    await t.test('does not duplicate articles across suppliers, orders and invoices', async () => {
      const result = await dashboard();
      assert.equal(result.rows.filter((r) => r.article_code === 'MP-BOTH').length, 1);
      assert.equal(result.rows.find((r) => r.article_code === 'MP-BOTH').on_hand, 4);
    });
    await t.test('excludes other customers, partial names, code-only matches, hidden catalog and obsolete sources', async () => {
      const result = await dashboard();
      for (const code of ['MP-OTHER', 'MP-SUBSTRING', 'MP-CODE', 'MP-HIDDEN', 'MP-NOT-IN-CATALOG', 'MP-LEGACY', 'MP-MANUAL', 'MP-BLANK'])
        assert.ok(!codes(result).includes(code), code);
    });
    await t.test('preserves quantity-only customer output without costs or warehouse locations', async () => {
      const result = await dashboard();
      for (const row of result.rows)
        for (const key of ['warehouse_number', 'warehouse_name', 'source', 'unit_cost', 'stock_value']) assert.ok(!(key in row), key);
      assert.ok(!('stockValue' in result.summary));
      assert.deepEqual(result.breakdown.byWarehouse, []);
      for (const row of [...result.breakdown.byType, ...result.breakdown.byUnit]) assert.ok(!('stock_value' in row));
    });
    await t.test('preserves historical per-warehouse fallback and customer aggregation', async () => {
      const result = await dashboard({ day: '2026-11-03', query: 'MP-SUPPLIER' });
      assert.equal(result.rows[0].on_hand, 24);
      assert.equal((await dashboard({ query: 'MP-SUPPLIER', warehouse: 1 })).rows[0].on_hand, 30);
      await db.exec('begin');
      try {
        await db.exec("delete from workspace_warehouse_stock_history where article_code='MP-SUPPLIER' and warehouse_number=8 and snapshot_date='2026-11-04'");
        const fallback = await dashboard({ query: 'MP-SUPPLIER' });
        assert.equal(fallback.rows.reduce((sum, row) => sum + row.on_hand, 0), 30);
      } finally {
        await db.exec('rollback');
      }
    });
    await t.test('preserves search, article type, UDM, stock filters and pagination', async () => {
      assert.deepEqual(codes(await dashboard({ query: 'Supplier only' })), ['MP-SUPPLIER']);
      assert.equal((await dashboard({ type: 'CN' })).totalRows, 0);
      assert.equal((await dashboard({ unit: 'PZ' })).totalRows, 0);
      assert.equal((await dashboard({ stock: 'negative' })).totalRows, 0);
      const page = await dashboard({ limit: 1, offset: 1 });
      assert.equal(page.totalRows, 4);
      assert.deepEqual(codes(page), ['MP-INVOICE']);
    });
    await t.test('includes each authorized customer, and removal immediately restricts visibility', async () => {
      await scope(['501.00001', '501.00002']);
      assert.ok(codes(await dashboard()).includes('MP-BETA'));
      await scope(['501.00002']);
      assert.deepEqual(codes(await dashboard()), ['MP-BETA']);
    });
    await t.test('empty or missing business names never match', async () => {
      await scope(['501.00004', '501.00005']);
      assert.equal((await dashboard()).totalRows, 0);
    });
    await t.test('internal output remains identical to baseline', async () => {
      await scope([]);
      assert.deepEqual(await dashboard(), internalBefore);
    });
    await t.test('retains execute grants and restricted association table access', async () => {
      const { rows } = await db.query(`select
        has_function_privilege('authenticated', 'public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer)', 'execute') allowed,
        has_function_privilege('anon', 'public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer)', 'execute') anonymous,
        has_table_privilege('authenticated', 'public.workspace_article_supplier_associations', 'select') associations`);
      assert.deepEqual(rows[0], { allowed: true, anonymous: false, associations: false });
    });
    await t.test('migration is safe to rerun', async () => {
      await scope(['501.00001']);
      const result = await dashboard();
      await db.exec(migration);
      assert.deepEqual(await dashboard(), result);
    });
  } finally {
    await db.close();
  }
});
