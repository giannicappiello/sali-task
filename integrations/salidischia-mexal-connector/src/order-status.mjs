export const SYNC_STATUS_META_KEY='_sdi_mexal_sync_v1';
export function syncErrorCode(error,record){
 const message=record?.status==='reconciliation_required'&&record.last_error?record.last_error:String(error?.message||'');
 const api=/Mexal (\d{1,8}), campo ([a-z][a-z0-9_]{0,63})\./i.exec(message);
 if(api)return `mexal_${api[1]}_${api[2].toLowerCase()}`;
 if(/già acquisito ma modificato/.test(message))return 'order_changed';
 if(/incompleto o incerto|riconciliazione/.test(message))return 'reconciliation_required';
 if(/HTTP \d+/.test(message))return 'api_error';
 if(/indirizzo|address|indicazioni/i.test(message))return 'address_invalid';
 if(/totali|Totali|IVA.*diversa|Totale.*diverso/.test(message))return 'totals_mismatch';
 return 'validation_failed';
}
export async function publishOrderStatus({source,result,record,error,woo,catalogAt=null,now=new Date().toISOString()}){
 const verified=['imported','already-imported'].includes(result?.mode);
 const value={version:1,source_order_id:String(source.id),status:verified?'verified':'blocked',error_code:verified?'':syncErrorCode(error,record),phase:verified?'verified':record?.last_phase||'validation',reference:verified?record.document_ref:null,checked_at:now,catalog_at:catalogAt};
 if(verified&&record.verification_json)value.amount_comparison=JSON.parse(record.verification_json);
 const existing=(source.meta_data||[]).filter(x=>x.key===SYNC_STATUS_META_KEY);
 const stable=x=>JSON.stringify([x.version,x.source_order_id,x.status,x.error_code,x.phase,x.reference,x.checked_at?.slice(0,13),x.catalog_at?.slice(0,13),x.amount_comparison]);
 if(existing.length===1&&stable(existing[0].value||{})===stable(value))return 'unchanged';
 await woo.publishMexalSyncStatus(Number(source.id),value);
 const saved=await woo.order(source.id),matches=(saved.meta_data||[]).filter(x=>x.key===SYNC_STATUS_META_KEY);
 if(matches.length!==1||JSON.stringify(matches[0].value)!==JSON.stringify(value))throw Error('Stato sincronizzazione non confermato sul sito.');
 for(const field of ['id','status','currency','total','total_tax','shipping_total'])if(String(saved[field]??'')!==String(source[field]??''))throw Error('Dati ordine cambiati durante la pubblicazione stato.');
 return 'updated';
}
