export const ORDER_REFERENCE_META_KEY='_sdi_mexal_oc_v1';
export async function syncVerifiedOrderReference({source,plan,record,woo}){
 if(record?.status!=='verified'||record.plan_hash!==plan.hash||String(source.id)!==plan.orderId||!/^OC\+\d{1,3}\+[1-9]\d{0,9}$/.test(record.document_ref||''))throw Error('Riferimento OC non verificato: pubblicazione bloccata.');
 const same=value=>value?.version===1&&value.verified===true&&value.source_order_id===plan.orderId&&value.company===plan.company&&value.year===Number(plan.year)&&value.reference===record.document_ref;
 const existing=(source.meta_data||[]).filter(x=>x.key===ORDER_REFERENCE_META_KEY);
 if(existing.length===1&&same(existing[0].value))return 'unchanged';
 const value={version:1,verified:true,source_order_id:plan.orderId,company:plan.company,year:Number(plan.year),reference:record.document_ref,verified_at:new Date().toISOString()};
 await woo.publishMexalOrderReference(Number(plan.orderId),value);
 const saved=await woo.order(plan.orderId),matches=(saved.meta_data||[]).filter(x=>x.key===ORDER_REFERENCE_META_KEY);
 if(matches.length!==1||!same(matches[0].value))throw Error('Riferimento OC non confermato sul sito.');
 for(const field of ['id','status','currency','total','total_tax','shipping_total'])if(String(saved[field]??'')!==String(source[field]??''))throw Error('Dati ordine cambiati durante la pubblicazione del riferimento OC: verificare.');
 return 'updated';
}
