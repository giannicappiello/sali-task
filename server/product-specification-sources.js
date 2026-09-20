import { rows, key } from './private-documents-store.js';
import { buildMexalClient, loadFullArticle } from './mexal/sync-products.js';
import { createProgremesProductionClient } from './progremes-production-client.js';

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
export async function loadSpecificationSources(identity, code, { formulaClient = createProgremesProductionClient } = {}) {
  const { admin, customerCodes } = identity;
  // Customer resolution applies to both bulk formulas and finished articles.
  const [lots, genealogy] = await Promise.all([
    rows(admin, 'workspace_private_document_lots', 'customer_code', q => q.eq('article_code', key(code))),
    rows(admin, 'workspace_sl_genealogy', 'codice_cliente', q => q.eq('codice_articolo_prodotto', key(code))),
  ]);
  const codes = [...new Set([...lots.map(l => l.customer_code), ...genealogy.map(g => g.codice_cliente)]
    .map(key).filter(Boolean).filter(c => customerCodes.includes('*') || customerCodes.map(key).includes(c)))];
  const customers = codes.length ? await admin.from('ordini_clienti_cache').select('codice_cliente,ragione_sociale').in('codice_cliente', codes) : { data: [] };
  if (customers.error) throw customers.error;
  const customerData = {
    customerNames: [...new Set((customers.data || []).map(c => String(c.ragione_sociale || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it')),
    missingCustomerNames: codes.filter(c => !(customers.data || []).some(row => key(row.codice_cliente) === c && String(row.ragione_sociale || '').trim())).length,
  };
  if (/^FP/i.test(code)) {
    const [{ result }, article] = await Promise.all([
      formulaClient().formulaSpecification({ articleCode: code }),
      admin.from('ordini_prodotti_cache').select('descrizione,dati_mexal').eq('codice_articolo', key(code)).maybeSingle(),
    ]);
    if (article.error) throw article.error;
    const raw = article.data?.dati_mexal;
    // Mexal stores a continuation, including meaningful spaces at the boundary.
    const description = (raw?.descrizione
      ? String(raw.descrizione) + String(raw.descrizione_agg || '')
      : String(article.data?.descrizione || '')).replace(/\s+/g, ' ').trim();
    if (!result.formulaData) throw new Error('Specifiche della formula non disponibili in MES.');
    return { specificationKind: 'bulk', formulaData: { ...result.formulaData, ...(description ? { description } : {}) }, components: [], ...customerData, photoUrl: null, bomError: '' };
  }
  const [product, revision] = await Promise.all([
    admin.from('prodotti').select('immagine_catalogo_url').eq('codice_mexal', code).maybeSingle(),
    admin.from('workspace_finished_bom_revisions').select('id,revision').eq('finished_article_code', code).eq('is_current', true).maybeSingle(),
  ]);
  if (product.error || revision.error) throw product.error || revision.error;
  let lines = revision.data ? await rows(admin, 'workspace_finished_bom_lines', 'article_code,description', q => q.eq('revision_id', revision.data.id).eq('is_removed', false)) : [];
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
    ...customerData,
  };
}
