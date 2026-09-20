import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { validateSpecification, productSpecificationOperation, specificationRequiresWrite } from './product-specifications.js';

const payload = (extra = {}) => ({ expectedVersion: 0, data: { description: '  Prodotto finito  ', dipTubeCut: 'no' }, attachments: [], ...extra });
function fixture({ customers = ['*'], canWrite = true, files = [], lots = [] } = {}) {
  const tables = {
    ordini_prodotti_cache: [{ codice_articolo: 'IT0001' }, { codice_articolo: 'MP001' }],
    workspace_private_nas_files: files, workspace_product_specifications: [], workspace_product_specification_revisions: [],
    workspace_product_specification_access_log: [], workspace_private_document_lots: lots,
    workspace_private_documents: [], workspace_sl_genealogy: [], documenti_workspace: [],
  };
  let writes = 0;
  const admin = {
    from(table) {
      const filters = []; let cap = Infinity;
      const result = () => (tables[table] || []).filter(r => filters.every(f => f(r))).slice(0, cap);
      const builder = {
        select() { return this; }, eq(k, v) { filters.push(r => r[k] === v); return this; },
        in(k, v) { filters.push(r => v.includes(r[k])); return this; }, or() { return this; }, order() { return this; },
        limit(n) { cap = n; return this; },
        async range(start, end) { return { data: result().slice(start, end + 1), count: result().length }; },
        async maybeSingle() { return { data: result()[0] || null }; },
        async insert(value) { tables[table].push(value); return {}; },
        then(resolve, reject) { return Promise.resolve({ data: result() }).then(resolve, reject); },
      };
      return builder;
    },
    async rpc(name, args) {
      assert.equal(name, 'save_workspace_product_specification'); writes++;
      const current = tables.workspace_product_specifications.find(r => r.article_code === args.p_article_code);
      if ((current?.version || 0) !== args.p_expected_version) return { error: { code: 'PT409' } };
      const saved = { article_code: args.p_article_code, version: args.p_expected_version + 1, data: args.p_data,
        attachments: args.p_attachments, updated_at: '2026-09-20T12:00:00Z', updated_by_label: args.p_user_label };
      tables.workspace_product_specifications = [saved]; tables.workspace_product_specification_revisions.push(saved);
      return { data: saved };
    },
  };
  return { tables, identity: { admin, profile: { id: 'user', email: 'editor@example.test' }, customerCodes: customers, canWriteDocuments: canWrite }, writes: () => writes };
}
const path = 'specifications/save?articleCode=IT0001';

test('capitolato: campi ammessi, lunghezze, tipi e percorsi sono validati', () => {
  const normalized = validateSpecification(payload({ data: { description: '  Test  ', injected: true } }));
  assert.equal(normalized.data.description, 'Test'); assert.equal(normalized.data.injected, undefined);
  for (const change of [{ expectedVersion: -1 }, { expectedVersion: '0' }, { data: [] }, { data: { description: 1 } },
    { data: { format: 'x'.repeat(501) } }, { data: { dipTubeCut: 'maybe' } }, { attachments: Array(41).fill({}) }]) {
    assert.throws(() => validateSpecification(payload(change)));
  }
  for (const file of ['../secret.jpg', 'C:/secret.jpg', '/secret.jpg', 'a//b.jpg', 'a/file.svg', 'a/file.html']) {
    assert.throws(() => validateSpecification(payload({ attachments: [{ section: 'product', path: file }] })));
  }
  assert.throws(() => validateSpecification(payload({ attachments: [{ section: 'product', path: 'a/file.pdf' }] })), /immagine/);
  const a = { section: 'primary', path: 'NAS/foto.jpg', caption: 'Flacone' };
  assert.throws(() => validateSpecification(payload({ attachments: [a, { ...a, path: 'nas/FOTO.jpg' }] })), /già associato/);
  assert.equal(validateSpecification(payload({ attachments: [a, { ...a, section: 'product' }] })).attachments.length, 2);
});

test('capitolato: il salvataggio richiede permesso scrittura e utente interno', async () => {
  assert.equal(specificationRequiresWrite('/specifications/save'), true);
  assert.equal(specificationRequiresWrite('/specifications'), false);
  for (const options of [{ canWrite: false }, { customers: ['501.A'] }]) {
    const f = fixture(options);
    await assert.rejects(productSpecificationOperation(f.identity, path, payload()), e => e.status === 403);
    assert.equal(f.writes(), 0);
  }
});

test('capitolato: riservato ai prodotti finiti esistenti', async () => {
  const f = fixture();
  for (const code of ['MP001', 'IT9999', '']) {
    await assert.rejects(productSpecificationOperation(f.identity, 'specifications?articleCode=' + code));
  }
  assert.deepEqual(await productSpecificationOperation(f.identity, 'specifications?articleCode=IT0001'), { specification: null });
});

test('capitolato: isolamento clienti per articolo anche per storico e allegati', async () => {
  const options = { customers: ['501.A'], lots: [{ article_code: 'IT0001', lot_code: 'L1', customer_code: '501.B' }] };
  const f = fixture(options);
  for (const route of ['specifications', 'specifications/history', 'specifications/file']) {
    await assert.rejects(productSpecificationOperation(f.identity, route + '?articleCode=IT0001'), e => e.status === 404);
  }
  f.tables.workspace_private_document_lots[0].customer_code = '501.A';
  assert.deepEqual(await productSpecificationOperation(f.identity, 'specifications?articleCode=IT0001'), { specification: null });
});

test('capitolato: file inesistenti o inattivi impediscono il salvataggio', async () => {
  const f = fixture({ files: [{ path_key: 'NAS/FOTO.JPG', path: 'NAS/foto.jpg', active: false }] });
  for (const name of ['NAS/foto.jpg', 'NAS/missing.jpg']) {
    await assert.rejects(productSpecificationOperation(f.identity, path, payload({ attachments: [{ section: 'product', path: name }] })), /non disponibile/);
  }
  assert.equal(f.writes(), 0);
});

test('capitolato: salva riferimenti canonici, rilegge da un’altra sessione e rileva versioni obsolete', async () => {
  const f = fixture({ files: [{ path_key: 'NAS/FOTO.JPG', path: 'NAS/Foto.jpg', active: true }] });
  const saved = await productSpecificationOperation(f.identity, path, payload({ attachments: [{ section: 'product', path: 'nas/foto.jpg' }] }));
  assert.equal(saved.version, 1); assert.equal(saved.attachments[0].path, 'NAS/Foto.jpg');
  const secondUser = { ...f.identity, profile: { id: 'second-user' }, canWriteDocuments: false };
  assert.deepEqual((await productSpecificationOperation(secondUser, 'specifications?articleCode=IT0001')).specification, saved);
  await assert.rejects(productSpecificationOperation(f.identity, path, payload()), e => e.status === 409);
  assert.equal(f.tables.workspace_product_specifications[0].version, 1);
  const updated = await productSpecificationOperation(f.identity, path, payload({ expectedVersion: 1 }));
  assert.equal(updated.version, 2);
  assert.equal((await productSpecificationOperation(secondUser, 'specifications/history?articleCode=IT0001')).revisions.length, 2);
});

test('capitolato: non firma percorsi arbitrari, rimossi o non attivi', async () => {
  const f = fixture({ files: [{ path_key: 'NAS/FOTO.JPG', path: 'NAS/Foto.jpg', active: true }] });
  const saved = await productSpecificationOperation(f.identity, path, payload({ attachments: [{ section: 'product', path: 'nas/foto.jpg' }] }));
  await assert.rejects(productSpecificationOperation(f.identity, 'specifications/file?articleCode=IT0001&attachmentId=arbitrary'), e => e.status === 404);
  f.tables.workspace_private_nas_files[0].active = false;
  await assert.rejects(productSpecificationOperation(f.identity, 'specifications/file?articleCode=IT0001&attachmentId=' + saved.attachments[0].id), e => e.status === 404);
  assert.equal(f.tables.workspace_product_specification_access_log.length, 0);
});

test('capitolato: apertura allegato autorizzato registra accesso prima del link firmato', async () => {
  const originalUrl = process.env.DOCUMENT_GATEWAY_URL, originalSecret = process.env.DOCUMENT_GATEWAY_SECRET;
  process.env.DOCUMENT_GATEWAY_URL = 'https://gateway.example.test';
  process.env.DOCUMENT_GATEWAY_SECRET = 'test-only-secret-0000000000000000000000000';
  try {
    const f = fixture({ files: [{ path_key: 'NAS/FOTO.JPG', path: 'NAS/Foto.jpg', active: true }] });
    const saved = await productSpecificationOperation(f.identity, path, payload({ attachments: [{ section: 'product', path: 'NAS/Foto.jpg' }] }));
    const result = await productSpecificationOperation(f.identity, 'specifications/file?articleCode=IT0001&attachmentId=' + saved.attachments[0].id);
    assert.match(result.url, /^https:\/\/gateway\.example\.test\/files\/NAS\/Foto\.jpg\?expires=\d+&signature=[a-f0-9]{64}$/);
    assert.deepEqual(f.tables.workspace_product_specification_access_log, [{ article_code: 'IT0001', user_id: 'user', attachment_id: saved.attachments[0].id }]);
  } finally {
    if (originalUrl === undefined) delete process.env.DOCUMENT_GATEWAY_URL; else process.env.DOCUMENT_GATEWAY_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.DOCUMENT_GATEWAY_SECRET; else process.env.DOCUMENT_GATEWAY_SECRET = originalSecret;
  }
});
