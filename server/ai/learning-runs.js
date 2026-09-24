// Errors are recorded without copying connection strings, URLs or provider payloads.
export async function recordLearningRun(admin, scan) {
  const {data:run,error:createError}=await admin.from('ai_learning_runs').insert({state:'running'}).select('id').single();
  if(createError)throw createError;
  try {
    const result=await scan();
    const state=result.connectorDisabled?'connector_disabled':result.candidates>0?'completed':'no_evidence';
    const {error}=await admin.from('ai_learning_runs').update({
      state,finished_at:new Date().toISOString(),candidates:result.candidates || 0,proposals_created:result.created || 0,
      detail:state==='connector_disabled'?'Connettore ProgreMES non abilitato.':state==='no_evidence'?'Nessuna evidenza utilizzabile restituita dal motore MES.':null,
    }).eq('id',run.id);
    if(error)throw error;
    return {...result,runId:run.id};
  } catch(error) {
    const {error:persistError}=await admin.from('ai_learning_runs').update({
      state:'failed',finished_at:new Date().toISOString(),detail:'Analisi non completata. Verificare il collegamento MES e i log del servizio con questo identificativo.',
    }).eq('id',run.id);
    if(persistError)throw new AggregateError([error,persistError],`Analisi e registrazione esito non riuscite (${run.id}).`,{cause:error});
    throw Object.assign(new Error(`Analisi dei tempi non completata (${run.id}).`,{cause:error}),{runId:run.id});
  }
}
