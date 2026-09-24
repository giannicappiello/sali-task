const changes = { type: 'object', additionalProperties: false, minProperties: 1, properties: {
  nome: { type: 'string', minLength: 1, maxLength: 500 }, descrizione: { type: ['string', 'null'], maxLength: 10000 }, mostra_in_app: { type: 'boolean' },
} };
export const productBulkSchema = { type: 'object', additionalProperties: false, required: ['items', 'reason'], properties: {
  reason: { type: 'string', minLength: 5, maxLength: 500 }, items: { type: 'array', minItems: 1, maxItems: 100, items: {
    type: 'object', additionalProperties: false, required: ['id', 'changes'], properties: { id: { type: 'string', format: 'uuid' }, changes },
  } },
} };
export const productChangeSchema = { type: 'object', additionalProperties: false, required: ['targetId', 'changes', 'reason'], properties: {
  targetId: { type: 'string', format: 'uuid' }, changes, reason: { type: 'string', minLength: 5, maxLength: 500 },
} };

export async function productChangePreview(auth, tool, input) {
  if (typeof input?.reason !== 'string' || input.reason.trim().length < 5 || input.reason.length > 500) throw new Error('Indica il motivo della modifica (5–500 caratteri).');
  const items = tool === 'ARTICLE_UPDATE' ? [{ id: input.targetId, changes: input.changes }] : input.items;
  if (!Array.isArray(items) || !items.length || items.length > 100 || new Set(items.map(i => i?.id)).size !== items.length) throw new Error('Elenco prodotti vuoto, duplicato o oltre 100 elementi.');
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)) throw new Error('Identificativo prodotto non valido.');
    if (!item.changes || !Object.keys(item.changes).length || Object.keys(item.changes).some(k => !['nome', 'descrizione', 'mostra_in_app'].includes(k))) throw new Error('Campo prodotto non modificabile.');
    const values = item.changes;
    if ('nome' in values && (typeof values.nome !== 'string' || !values.nome.trim() || values.nome.length > 500)) throw new Error('Nome prodotto non valido.');
    if ('descrizione' in values && values.descrizione !== null && (typeof values.descrizione !== 'string' || values.descrizione.length > 10000)) throw new Error('Descrizione prodotto non valida.');
    if ('mostra_in_app' in values && typeof values.mostra_in_app !== 'boolean') throw new Error('Visibilità prodotto non valida.');
  }
  const { data, error } = await auth.scoped.from('prodotti').select('id,nome,descrizione,mostra_in_app').in('id', items.map(i => i.id));
  if (error) throw error;
  const rows = new Map((data || []).map(row => [row.id, row]));
  if (rows.size !== items.length) throw Object.assign(new Error('Uno o più prodotti non sono visibili o non esistono.'), { status: 403 });
  const preview = items.map(item => ({ id: item.id, changes: item.changes, before: rows.get(item.id) }));
  return tool === 'ARTICLE_UPDATE' ? { ...input, before: preview[0].before } : { items: preview, reason: input.reason, targetId: `${items.length} prodotti` };
}
