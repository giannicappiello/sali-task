/* global process */
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export async function companyCalendarRequest(req, db, secret=process.env.PROGREMES_INTEGRATION_SECRET) {
  const actual=String(req.headers?.['x-workspace-secret']||'');
  const expected=String(secret||'');
  if(!expected || Buffer.byteLength(actual)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual),Buffer.from(expected))) throw Object.assign(new Error('Autenticazione MES non valida'),{status:401});
  if(!['GET','POST'].includes(req.method))throw Object.assign(new Error('Metodo non consentito'),{status:405});
  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body);}catch{throw Object.assign(new Error('JSON non valido'),{status:400});}}
  if(req.method==='POST'&&(!Array.isArray(body?.closures)||body.closures.length>5000))throw Object.assign(new Error('Chiusure non valide'),{status:400});
  const client=db||createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  const {data,error}=await client.rpc(req.method==='POST'?'workspace_company_calendar_import':'workspace_company_calendar_data',req.method==='POST'?{p_closures:body.closures}:{});
  if(error)throw new Error('Calendario non disponibile');
  return data;
}
export async function handleCompanyCalendar(req,res){
  res.setHeader('Cache-Control','private, no-store');
  try{return res.status(200).json(await companyCalendarRequest(req));}
  catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Calendario aziendale non disponibile'});}
}
