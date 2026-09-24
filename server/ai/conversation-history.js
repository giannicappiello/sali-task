const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 50;
export async function readConversationPage(admin, ownerId, conversationId, cursor) {
  if (!UUID.test(conversationId || '')) throw Object.assign(new Error('Conversazione non valida.'), {status:400});
  const {data:conversation,error:lookupError} = await admin.from('ai_conversazioni')
    .select('id,titolo,modalita,argomento_id,creata_il,aggiornata_il')
    .eq('id',conversationId).eq('utente_id',ownerId).maybeSingle();
  if (lookupError) throw lookupError;
  if (!conversation) throw Object.assign(new Error('Conversazione non trovata.'),{status:404});
  let query = admin.from('ai_messaggi').select('id,ruolo,contenuto,fonti,metadati,creato_il')
    .eq('conversazione_id',conversationId).order('creato_il',{ascending:false}).order('id',{ascending:false}).limit(PAGE_SIZE + 1);
  if (cursor) {
    if (!UUID.test(cursor.id || '') || typeof cursor.at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(cursor.at) || !Number.isFinite(Date.parse(cursor.at))) {
      throw Object.assign(new Error('Pagina della cronologia non valida.'),{status:400});
    }
    query = query.or(`creato_il.lt.${cursor.at},and(creato_il.eq.${cursor.at},id.lt.${cursor.id})`);
  }
  const {data,error} = await query;
  if(error)throw error;
  const rows=(data || []).slice(0,PAGE_SIZE);
  const last=rows.at(-1);
  return {conversation,messages:rows.reverse(),nextCursor:data?.length>PAGE_SIZE ? {at:last.creato_il,id:last.id}:null};
}
