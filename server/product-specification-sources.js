import { rows, key } from './private-documents-store.js';
import { buildMexalClient, loadFullArticle } from './mexal/sync-products.js';

export async function readSpecificationBom(admin, code, mexal = buildMexalClient({ warehouse: null, timeoutMs: 12000 }), ancestors = [], budget = { calls: 0 }) {
  if (ancestors.includes(key(code)) || ancestors.length >= 6 || ++budget.calls > 20) throw new Error('Distinta base ricorsiva o troppo estesa.');
  const items = [], tokens = new Set();
  let next = '';
  do {
    const query = new URLSearchParams({ max: '1000', fields: 'codice,codice_mp,qta_utilizzo' });
    if (next) query.set('next', next);
    const result = await mexal.postJson(`/distinte-base/componenti/ricerca?${query}`, { filtri: [{ campo: 'codice', condizione: 'inizia_per', valore: code }] });
    if (!Array.isArray(result.dati)) throw new Error('Distinta base Mexal non disponibile.');
    items.push(...result.dati.filter(r => key(r.codice) === key(code) && Number(String(r.qta_utilizzo).replace(',', '.')) > 0));
    next = String(result.next || '');
    if (next && (tokens.has(next) || tokens.size >= 10)) throw new Error('Lettura distinta base incompleta.');
    tokens.add(next);
  } while (next);
  const codes = [...new Set(items.map(r => key(r.codice_mp)).filter(Boolean))];
  const articles = codes.length ? await rows(admin, 'ordini_prodotti_cache', 'codice_articolo,descrizione', q => q.in('codice_articolo', codes)) : [];
  const lines = [];
  for (const component of codes) {
    let description = articles.find(a => key(a.codice_articolo) === component)?.descrizione || '';
    if (!description) {
      const detail = await loadFullArticle(mexal, component);
      description = `${String(detail?.descrizione || '').trimEnd()}${String(detail?.descrizione_agg || '').trimStart()}`.replace(/\s+/g, ' ').trim();
    }
    lines.push({ article_code: component, description });
    // Finished subassemblies can contain the FP and primary packaging (e.g. ITxxxx-SING).
    if (/^(IT|DC|CO|BT|DD|CW|DR)/.test(component))
      lines.push(...await readSpecificationBom(admin, component, mexal, [...ancestors, key(code)], budget));
  }
  return lines;
}

// Called only after authorizing access to the finished article.
export async function loadSpecificationSources(identity, code) {
  const { admin, customerCodes } = identity;
  const results = await Promise.all([
    admin.from('prodotti').select('immagine_catalogo_url').eq('codice_mexal', code).maybeSingle(),
    admin.from('workspace_finished_bom_revisions').select('id,revision').eq('finished_article_code', code).eq('is_current', true).maybeSingle(),
    rows(admin, 'workspace_private_document_lots', 'customer_code', q => q.eq('article_code', key(code))),
    rows(admin, 'workspace_sl_genealogy', 'codice_cliente', q => q.eq('codice_articolo_prodotto', code)),
  ]);
  for (const result of results.slice(0, 2)) if (result.error) throw result.error;
  const [product, revision, lots, genealogy] = results;
  const codes = [...new Set([...lots.map(l => l.customer_code), ...genealogy.map(g => g.codice_cliente)]
    .filter(Boolean).filter(c => customerCodes.includes('*') || customerCodes.includes(c)))];
  let [lines, customers] = await Promise.all([
    revision.data ? rows(admin, 'workspace_finished_bom_lines', 'article_code,description', q => q.eq('revision_id', revision.data.id).eq('is_removed', false)) : [],
    codes.length ? admin.from('ordini_clienti_cache').select('codice_cliente,ragione_sociale').in('codice_cliente', codes) : { data: [] },
  ]);
  if (customers.error) throw customers.error;
  let bomError = '';
  if (!revision.data) {
    try { lines = await readSpecificationBom(admin, code); }
    catch { bomError = 'Impossibile leggere la distinta base. Riprova a ricaricare il capitolato.'; }
  }
  const components = [...new Map(lines.map(l => [key(l.article_code), { code: key(l.article_code), description: l.description || '' }])).values()];
  return {
    photoUrl: /^IT/i.test(code) ? product.data?.immagine_catalogo_url || null : null,
    bomRevision: revision.data?.revision || null,
    bomError,
    components,
    customerNames: [...new Set(customers.data.map(c => c.ragione_sociale).filter(Boolean))],
    missingCustomerNames: codes.filter(c => !customers.data.some(row => row.codice_cliente === c && row.ragione_sociale)).length,
  };
}
