import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {assert} from '../shared/orderPreparation.js';
import {checked} from './order-preparation-auth.js';

export function createMesDdtPrinting({env=globalThis.process.env,transport=fetch}={}) {
  async function request(path,{body,method='GET'}={}) {
    assert(env.PROGREMES_URL && env.PROGREMES_INTEGRATION_SECRET,'Collegamento al servizio stampa MES non configurato.',503);
    const url=new URL('/api/workspace/v1/'+path,env.PROGREMES_URL);
    assert(url.protocol==='https:','Collegamento stampa MES non sicuro.',503);
    const response=await transport(url,{method,body,redirect:'error',signal:AbortSignal.timeout(60000),headers:{'X-Workspace-Secret':env.PROGREMES_INTEGRATION_SECRET,...(body?{'Content-Type':'application/pdf'}:{})}});
    let result;
    try {result=await response.json();}catch {throw Object.assign(new Error('Servizio stampa MES non disponibile (HTTP '+response.status+').'),{status:503});}
    assert(response.ok,result.code || 'Servizio stampa MES non disponibile.',response.status);
    return result;
  }
  async function inventory(db) {
    const result=await request('printers');
    assert(result.enabled,'Servizio stampa MES disattivato: verifica Impostazioni → Stampanti.',503);
    assert(Array.isArray(result.printers),'Inventario stampanti MES non valido.',503);
    const printers=result.printers.filter(p=>p.canPrintSilently && p.available).map(p=>p.name);
    checked(await db.rpc('warehouse_print_worker',{p_station:'MES',p_action:'inventory',p_input:{printers}}));
    return result;
  }
  async function sync(db,id) {
    const claim=checked(await db.rpc('warehouse_mes_print',{p_id:id,p_action:'claim',p_token:null,p_data:{}}));
    if(!claim.acquired)return claim.job;
    const job=claim.job;
    try {
      let remote;
      if(job.provider_job_id) remote=await request('print/'+job.provider_job_id);
      else {
        // A selectable copy count uses the original single-copy DDT, never the archived three-copy PDF.
        const kind=job.copies != null && job.document_kind==='bcf_print' ? 'bcf' : job.document_kind;
        const copies=job.copies ?? 1;
        assert(Number.isInteger(copies) && copies>=1 && copies<=50,'Numero copie non valido.');
        const doc=checked(await db.from('warehouse_preparation_documents').select('filename,base64,sha256').eq('preparation_id',job.preparation_id).eq('kind',kind).single());
        const bytes=Buffer.from(doc.base64,'base64');
        assert(createHash('sha256').update(bytes).digest('hex')===doc.sha256,'Integrità PDF non verificata.');
        const query=new URLSearchParams({requestId:'ddt:'+job.id,documentType:'warehouse',fileName:doc.filename,printer:job.printer_id.slice(4),copies:String(copies),relatedId:job.preparation_id});
        if(job.reprint_of){
          const original=checked(await db.from('warehouse_print_jobs').select('provider_job_id').eq('id',job.reprint_of).single());
          assert(original.provider_job_id,'Verifica prima l’esito della stampa originale.',409);
          query.set('forceReprint','true');query.set('reprintOfJobId',original.provider_job_id);
        }
        remote=await request('print?'+query,{method:'POST',body:bytes});
      }
      assert(remote.requestId==='ddt:'+job.id && remote.printer===job.printer_id.slice(4) && ['Queued','Printing','Completed','Failed'].includes(remote.status),'Risposta stampa MES non coerente.',502);
      return checked(await db.rpc('warehouse_mes_print',{p_id:id,p_action:'result',p_token:job.token,p_data:{providerId:remote.id,status:remote.status,error:remote.error || null}}));
    } catch(error) {
      return checked(await db.rpc('warehouse_mes_print',{p_id:id,p_action:'error',p_token:job.token,p_data:{error:error.message}}));
    }
  }
  return {inventory,sync};
}
