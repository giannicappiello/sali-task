export const SHEET_FIELDS = [
  ['description', 'Descrizione'], ['features', 'Caratteristiche'],
  ['active_ingredients', 'Principi Attivi'], ['inci', 'INCI/CTFA'],
  ['directions', 'Modo d’uso'], ['warnings', 'Avvertenze/Controindicazioni'],
].map(([key, label]) => ({ key, label }));
export const SHEET_LANGUAGES = [
  { code: 'IT', label: 'Italiano', locale: 'it_IT', headings: ['Foto prodotto','Nome prodotto','Codice articolo','EAN','Categoria','Formato','Descrizione','Caratteristiche','Principi Attivi','INCI/CTFA','Modo d’uso','Avvertenze/Controindicazioni'] },
  { code: 'ENG', label: 'English', locale: 'en_GB', headings: ['Product photo','Product name','Item code','EAN','Category','Size','Description','Features','Active ingredients','INCI/CTFA','Directions for use','Warnings/Contraindications'] },
  { code: 'FR', label: 'Français', locale: 'fr_FR', headings: ['Photo du produit','Nom du produit','Code article','EAN','Catégorie','Format','Description','Caractéristiques','Principes actifs','INCI/CTFA','Mode d’emploi','Avertissements/Contre-indications'] },
  { code: 'DE', label: 'Deutsch', locale: 'de_DE', headings: ['Produktfoto','Produktname','Artikelnummer','EAN','Kategorie','Inhalt','Beschreibung','Eigenschaften','Wirkstoffe','INCI/CTFA','Anwendung','Warnhinweise/Gegenanzeigen'] },
  { code: 'ES', label: 'Español', locale: 'es_ES', headings: ['Foto del producto','Nombre del producto','Código de artículo','EAN','Categoría','Formato','Descripción','Características','Principios activos','INCI/CTFA','Modo de uso','Advertencias/Contraindicaciones'] },
  { code: 'PT', label: 'Português', locale: 'pt_PT', headings: ['Foto do produto','Nome do produto','Código do artigo','EAN','Categoria','Formato','Descrição','Características','Princípios ativos','INCI/CTFA','Modo de utilização','Advertências/Contraindicações'] },
];
export const TEMPLATE_FIELDS = [
  { key: 'photo', label: 'Foto prodotto', image: true },
  ...[['name', 'Nome prodotto'], ['code', 'Codice articolo'], ['ean', 'EAN'], ['category', 'Categoria'], ['format', 'Formato']].map(([key, label]) => ({ key, label })),
  ...SHEET_FIELDS,
];
export function fieldLabel(key, language = 'IT') {
  return (SHEET_LANGUAGES.find(l => l.code === language) || SHEET_LANGUAGES[0]).headings[TEMPLATE_FIELDS.findIndex(f => f.key === key)];
}
export function generationContent(sheet, translations, language) {
  if (!sheet || sheetStatus(sheet).count !== 6) throw new Error('Completa e salva tutti i sei campi della scheda italiana.');
  if (language === 'IT') return sheet.content;
  const row = translations.find(t => t.language === language);
  if (!row || !row.reviewed || row.source_revision !== sheet.revision || sheetStatus({ content: row.content }).count !== 6) throw new Error(`Traduzione ${language} assente, da rivedere o non aggiornata alla scheda italiana.`);
  return row.content;
}
export const emptySheet = () => Object.fromEntries(SHEET_FIELDS.map(({ key }) => [key, '']));
export function sheetStatus(sheet) {
  const count = sheet?.filled_count ?? SHEET_FIELDS.filter(({ key }) => String(sheet?.content?.[key] || '').trim()).length;
  return { count, label: count === 6 ? 'Completa' : count ? 'Parziale' : 'Da compilare', code: count === 6 ? 'complete' : count ? 'partial' : 'empty' };
}
export function sheetValues(product, content = {}) {
  const raw = product?.json_mexal || {};
  const mexalName = `${String(raw.descrizione || '').trimEnd()}${String(raw.descrizione_agg || '').trimStart()}`.replace(/\s+/g, ' ').trim();
  return { ...emptySheet(), ...content, name: mexalName || product?.nome || '', code: product?.codice_mexal || product?.codice || '',
    ean: product?.ean || '', category: product?.categoria_mexal || '',
    format: product?.formato || raw.formato || product?.confezione || raw.confezione || '',
    photo: product?.immagine_catalogo_url || product?.immagine_url || '' };
}
export function sheetText(content) {
  return SHEET_FIELDS.filter(({ key }) => content?.[key]?.trim()).map(({ key, label }) => `${label}\n${content[key].trim()}`).join('\n\n');
}
const html = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
export function sheetHtml(content) {
  return SHEET_FIELDS.filter(({ key }) => content?.[key]?.trim()).map(({ key, label }) => `<section><h2>${label}</h2><p>${html(content[key].trim()).replace(/\n/g, '<br>')}</p></section>`).join('\n');
}
export function defaultLayout() {
  return { pages: [{ id: 'page-1', width: 595.28, height: 841.89, background: '' }], boxes: TEMPLATE_FIELDS.map(({ key, image }, index) => ({
    id: key, field: key, page: 'page-1', x: index === 0 ? 68 : 6, y: index === 0 || key === 'name' ? 3 : index < 6 ? 9.5 + (index - 2) * 4 : 27 + (index - 6) * 11.5,
    width: index === 0 ? 26 : index < 6 ? 60 : 88, height: image ? 21 : key === 'name' ? 6.4 : index < 6 ? 4 : 11,
    font: 'helvetica', fontSize: key === 'name' ? 14 : index < 6 ? 9 : 10, bold: key === 'name', color: '#172033', align: 'left', vertical: 'top', showLabel: false,
  })) };
}
export function boundBox(box) {
  const width = Math.max(2, Math.min(100, Number(box.width) || 2)), height = Math.max(2, Math.min(100, Number(box.height) || 2));
  return { ...box, width, height, x: Math.max(0, Math.min(100 - width, Number(box.x) || 0)), y: Math.max(0, Math.min(100 - height, Number(box.y) || 0)) };
}
export function alignBoxes(boxes, ids, action) {
  const selected = boxes.filter(b => ids.includes(b.id));
  if (!selected.length || new Set(selected.map(b => b.page)).size !== 1) return boxes;
  const single = selected.length === 1;
  const left = single ? 0 : Math.min(...selected.map(b => b.x)), right = single ? 100 : Math.max(...selected.map(b => b.x + b.width));
  const top = single ? 0 : Math.min(...selected.map(b => b.y)), bottom = single ? 100 : Math.max(...selected.map(b => b.y + b.height));
  const changes = new Map();
  if (action === 'distribute-x' || action === 'distribute-y') {
    if (selected.length < 3) return boxes;
    const horizontal = action === 'distribute-x', key = horizontal ? 'x' : 'y', size = horizontal ? 'width' : 'height';
    const ordered = [...selected].sort((a, b) => a[key] - b[key]);
    const end = ordered.at(-1)[key] + ordered.at(-1)[size];
    const gap = (end - ordered[0][key] - ordered.reduce((sum, b) => sum + b[size], 0)) / (ordered.length - 1);
    let cursor = ordered[0][key];
    for (const box of ordered) { changes.set(box.id, { ...box, [key]: cursor }); cursor += box[size] + gap; }
  } else for (const b of selected) {
    const updated = { ...b };
    if (action === 'left') updated.x = left;
    if (action === 'center') updated.x = (left + right - b.width) / 2;
    if (action === 'right') updated.x = right - b.width;
    if (action === 'top') updated.y = top;
    if (action === 'middle') updated.y = (top + bottom - b.height) / 2;
    if (action === 'bottom') updated.y = bottom - b.height;
    if (action === 'same-width') updated.width = selected[0].width;
    if (action === 'same-height') updated.height = selected[0].height;
    changes.set(b.id, updated);
  }
  return boxes.map(b => changes.has(b.id) ? boundBox(changes.get(b.id)) : b);
}
