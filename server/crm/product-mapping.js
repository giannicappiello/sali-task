export async function persistProductMapping(db, connection, body, actorId) {
  const fail = message => { throw Object.assign(new Error(message),{status:400}); };
  const sku = String(body.externalSku || '').trim();
  if (!sku) fail('SKU esterno obbligatorio.');
  if (body.mappingId) {
    const current = await db.from('crm_product_mappings').select('id,connection_id').eq('id',body.mappingId).single();
    if (current.error) throw current.error;
    if (current.data.connection_id !== connection.id) fail('La riconciliazione non appartiene alla connessione selezionata.');
  }
  let productId = body.productId || null, code = body.codiceMexal || null;
  if (body.status === 'matched') {
    if (!productId && !code) fail('Seleziona il prodotto Workspace.');
    let query = db.from('prodotti').select('id,codice,codice_mexal');
    query = productId ? query.eq('id',productId) : query.eq('codice_mexal',code);
    const product = await query.single();
    if (product.error) throw product.error;
    if (['amazon_sp_api', 'woocommerce'].includes(connection.provider_code) && ![product.data.codice,product.data.codice_mexal].some(value=>/^IT/i.test(value || ''))) fail('Seleziona un prodotto con codice IT.');
    productId = product.data.id; code = product.data.codice_mexal || product.data.codice;
  }
  const payload = { ...(body.mappingId ? {id:body.mappingId} : {}),connection_id:connection.id,marketplace:body.marketplace || null,
    external_sku:sku,asin:body.asin || null,product_id:productId,codice_mexal:code,status:body.status || 'unmatched',match_method:'manual',
    verified_by:actorId,verified_at:new Date().toISOString(),aggiornato_il:new Date().toISOString() };
  const result = await db.from('crm_product_mappings').upsert(payload,{onConflict:'connection_id,marketplace,external_sku'}).select().single();
  if (result.error) throw result.error;
  return result.data;
}
