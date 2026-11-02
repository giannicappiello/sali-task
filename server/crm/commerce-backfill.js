export function amazonBackfillState(connection,from,now=new Date()){
 if(connection.provider_code!=='amazon_sp_api'||!connection.abilitata)throw Object.assign(new Error('Connessione Amazon attiva richiesta.'),{status:409});
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from||''))throw Object.assign(new Error('Data iniziale di recupero non valida.'),{status:400});
 const start=Date.parse(`${from}T00:00:00Z`),end=now.getTime()-180000;
 if(!Number.isFinite(start)||new Date(start).toISOString().slice(0,10)!==from||start>=end||end-start>366*86400000)throw Object.assign(new Error('Il recupero deve iniziare negli ultimi 366 giorni e prima di oggi.'),{status:400});
 if(connection.import_state?.completed===false||connection.amazon_cox_state?.active||connection.amazon_refund_state?.active)throw Object.assign(new Error('Completare la sincronizzazione in corso prima del recupero.'),{status:409});
 return {version:1,phase:'orders',priorityImported:true,page:1,token:null,marketplaceIndex:0,from:new Date(start).toISOString(),to:new Date(end).toISOString(),incremental:true,counts:{customers:0,products:0,orders:0},completed:false};
}

export async function prepareAmazonBackfill(db,connectionId,actorId,from,now=new Date()){
 const claim=await db.rpc('crm_claim_commerce_import_service',{target_connection_id:connectionId,target_triggered_by:actorId});
 if(claim.error)throw Object.assign(claim.error,{status:409});
 let failure=null,result;
 try{
  const read=await db.from('crm_external_connections').select('*').eq('id',connectionId).single();if(read.error)throw read.error;
  const state=amazonBackfillState(read.data,from,now);
  const saved=await db.from('crm_external_connections').update({import_state:state}).eq('id',connectionId).select('id').single();if(saved.error)throw saved.error;
  result={from:state.from,to:state.to};
 }catch(error){failure=error;}
 finally{
  const done=await db.rpc('crm_complete_sync_run_service',{target_run_id:claim.data,target_status:failure?'failed':'completed',target_counts:{read:0,inserted:0,updated:0,failed:failure?1:0},target_error_code:failure?'backfill_invalid':null,target_error_message:failure?.message||null,target_details:{resource:'amazon_backfill',from}});
  if(done.error&&!failure)failure=done.error;
 }
 if(failure)throw failure;
 return result;
}
