import { createClient } from "@supabase/supabase-js";
import { createProgremesClient } from "./progremes-readonly-client.js";
import { readAllRows, readRowsByIds } from "./private-orders-workbench.js";
import { calculateRecord, allocateBulkCosts, validateSettings, number, sumKnown } from "../src/features/production-costs/cost-engine.js";
import { withCustomerNames } from "../src/features/production-costs/search.js";
import { applicableConfiguration, legacyOrderRevenue } from "../src/features/production-costs/history.js";

const fail = (message,status=400) => Object.assign(new Error(message),{status});
const check = (result) => {if(result.error)throw result.error;return result.data;};
const CONFIG="produzione.configurazione_costi",REPORT="produzione.consuntivi";
export async function costSession(req,screen,write=false) {
 const token=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 if(!token)throw fail("Sessione mancante.",401);
 const env=globalThis.process.env,options={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,options);
 const auth=await admin.auth.getUser(token);
 if(auth.error||!auth.data?.user)throw fail("Sessione non valida.",401);
 const profile=check(await admin.from("utenti").select("id,attivo").eq("auth_user_id",auth.data.user.id).maybeSingle());
 if(!profile||!profile.attivo)throw fail("Profilo non attivo.",403);
 const level=check(await admin.rpc("workspace_screen_level_for_user",{target_user_id:profile.id,target_screen:screen}));
 if(!level||level==="nessuno"||(write&&!["scrittura","gestione","completo","amministrazione"].includes(level)))throw fail("Operazione non autorizzata su questa schermata.",403);
 const caller=createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY||env.SUPABASE_SERVICE_ROLE_KEY,{...options,global:{headers:{Authorization:`Bearer ${token}`}}});
 const snapshot=check(await caller.rpc("workspace_session_access"));
 if(!snapshot?.scope)throw fail("Ambito dati non disponibile.",403);
 return {admin,caller,profile,scope:snapshot.scope,canWrite:["scrittura","gestione","completo","amministrazione"].includes(level)};
}
function scoped(rows,scope) {
 const codes=scope.customer_codes|| (scope.customer_code?[scope.customer_code]:[]);
 // Customer accounts are always bounded, including mixed-customer productions.
 if(!codes.length&&scope.mode!=="cliente")return rows;
 return rows.filter(r=>r.evidence.customerCode&&codes.includes(r.evidence.customerCode)&&
  (r.evidence.links||[]).every(l=>codes.includes(l.customerCode)));
}
async function recordFor(session,id) {
 const r=check(await session.admin.from("production_cost_records").select("*").eq("mes_order_id",id).maybeSingle());
 if(!r||!scoped([r],session.scope).length)throw fail("Produzione non disponibile.",404);
 return r;
}
export function configurationFor(evidence,configs) {
 return applicableConfiguration(evidence,configs);
}
async function readConfigurations(admin) {return readAllRows(()=>admin.from("production_cost_configurations").select("*").order("effective_from",{ascending:false}).order("created_at",{ascending:false}));}
export async function handleProductionCosts(req,body) {
 const op=body.operation||"list",isConfig=["configuration","save-configuration","machines"].includes(op);
 const write=["save-configuration","adjust","allocate-invoice"].includes(op);
 const session=await costSession(req,isConfig?CONFIG:REPORT,write),{admin,caller,profile}=session;
 if(op==="configuration")return {configurations:await readConfigurations(admin),canWrite:session.canWrite};
 if(op==="save-configuration"){
  validateSettings(body.settings);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveFrom||""))throw fail("Data di decorrenza obbligatoria.");
  const configuration=check(await admin.from("production_cost_configurations").insert({
   settings:body.settings,effective_from:body.effectiveFrom,created_by:profile.id,note:String(body.note||"").slice(0,2000)
  }).select().single());
  check(await admin.rpc("production_cost_assign_missing_configurations"));
  if(body.applyToHistory===true){
   const history=await readAllRows(()=>admin.from("production_cost_records").select("*").order("mes_order_id"));
   const targets=history.filter(r=>!r.evidence.baseline&&configurationFor(r.evidence,[configuration]));
   for(let offset=0;offset<targets.length;offset+=100)check(await admin.from("production_cost_adjustments").insert(
    targets.slice(offset,offset+100).map(r=>({mes_order_id:r.mes_order_id,details:{configurationId:configuration.id},
     reason:"Applicazione esplicita della versione costi allo storico ricostruito",created_by:profile.id}))));
  }
  return {configuration};
 }
 if(op==="machines")return {machines:await createProgremesClient().request("production-cost-machines")};
 if(op==="sync"){
  // A page is atomic. The browser advances only after successful persistence;
  // repeated pages update evidence without overwriting the frozen cost revision.
  const page=Number(body.page||1);
  if(!Number.isInteger(page)||page<1||page>100000)throw fail("Pagina non valida.");
  let result;
  try {result=await createProgremesClient({timeoutMs:30000}).request("production-cost-evidence",{page,pageSize:100});}
  catch(error){throw fail(error.upstreamStatus===404?"Aggiornare MES: il collegamento ai consuntivi non è ancora installato. I dati già importati restano disponibili.":"MES non raggiungibile per i consuntivi. I dati già importati restano disponibili.",502);}
  const configs=await readConfigurations(admin);
  const existing=result.items.length?await readAllRows(()=>admin.from("production_cost_records").select("*").in("mes_order_id",result.items.map(x=>x.id)).order("mes_order_id")):[];
  const byId=new Map(existing.map(x=>[x.mes_order_id,x]));
  for(const e of result.items){
   const old=byId.get(e.id);
   check(await admin.from("production_cost_records").upsert({mes_order_id:e.id,evidence:e,
    configuration_id:old?.configuration_id||configurationFor(e,configs)?.id||null,refreshed_at:new Date().toISOString()}));
  }
  return {page,total:result.total,imported:result.items.length,hasMore:page*100<result.total};
 }
 if(op==="adjust"){
  await recordFor(session,Number(body.id));
  if(!String(body.reason||"").trim())throw fail("Indicare la fonte del dato consuntivo.");
  const washes=body.washes||[];
  if(!Array.isArray(washes)||washes.some(w=>!Number.isInteger(Number(w.productionId))||!Number.isInteger(Number(w.count))||Number(w.count)<0||number(w.minutes)===null||Number(w.minutes)<0))throw fail("Lavaggi non validi.");
  const source=await recordFor(session,Number(body.id));
  if(washes.some(w=>!source.evidence.works.some(x=>x.id===Number(w.productionId))))throw fail("Lavorazione non appartenente alla produzione.");
  check(await admin.from("production_cost_adjustments").insert({mes_order_id:body.id,details:{washes},reason:String(body.reason).slice(0,2000),created_by:profile.id}));
  return {saved:true};
 }
 if(op==="invoice-candidates"||op==="allocate-invoice"){
  const row=await recordFor(session,Number(body.id)),e=row.evidence;
  const invoices=await readAllRows(()=>caller.from("mexal_fatture_vendita").select("id,sigla,serie,numero,data_documento,codice_cliente").eq("codice_cliente",e.customerCode).order("id"));
  const lines=(await readRowsByIds(caller,"mexal_fatture_vendita_righe","fattura_id",invoices.map(x=>x.id)))
   .filter(l=>l.codice_articolo===e.articleCode&&number(l.quantita)!==null&&Math.abs(Number(l.quantita))>0)
   .map(l=>({...l,document:invoices.find(i=>i.id===l.fattura_id)}));
  if(op==="invoice-candidates")return {lines};
  const line=lines.find(l=>String(l.id)===String(body.lineId));
  if(!line)throw fail("Riga fattura non autorizzata o non compatibile con cliente e articolo.",403);
  if(number(body.quantity)===null||Number(body.quantity)<=0)throw fail("Quantità non valida.");
  check(await admin.rpc("production_cost_allocate_invoice",{p_order:Number(body.id),p_line:Number(body.lineId),p_quantity:Number(body.quantity),p_user:profile.id}));
  return {saved:true};
 }
 if(op!=="list")throw fail("Operazione non disponibile.");
 const [records,configs]=await Promise.all([
  readAllRows(()=>admin.from("production_cost_records").select("*").order("mes_order_id")),readConfigurations(admin)]);
 const visible=scoped(records,session.scope);
 // Enrich only customers belonging to already-authorized productions, including
 // all OCT customers of a shared production. Do not overwrite historical evidence.
 const customerCodes=[...new Set(visible.flatMap(r=>[r.evidence.customerCode,...(r.evidence.links||[]).map(l=>l.customerCode)]).map(c=>String(c||"").trim()).filter(Boolean))];
 const customerNames=new Map();
 for(let start=0;start<customerCodes.length;start+=100){
  const customers=await readAllRows(()=>admin.from("crm_classified_customers").select("codice_cliente,ragione_sociale")
   .in("codice_cliente",customerCodes.slice(start,start+100)).order("codice_cliente"));
  for(const customer of customers)if(customer.ragione_sociale?.trim())customerNames.set(String(customer.codice_cliente).trim(),customer.ragione_sociale);
 }
 const ids=visible.map(x=>x.mes_order_id);
 const adjustments=await readAllRows(()=>admin.from("production_cost_adjustments").select("*").order("created_at",{ascending:false}).order("id"));
 const allocations=await readAllRows(()=>admin.from("production_cost_invoice_allocations").select("*").order("id"));
 const allowedAllocations=allocations.filter(a=>ids.includes(a.mes_order_id));
 const invoiceLines=await readRowsByIds(caller,"mexal_fatture_vendita_righe","id",allowedAllocations.map(a=>a.invoice_line_id));
 const invoiceHeaders=await readRowsByIds(caller,"mexal_fatture_vendita","id",invoiceLines.map(a=>a.fattura_id));
 const orderLines=await readRowsByIds(caller,"ordini_righe","id",visible.flatMap(r=>(r.evidence.links||[]).map(l=>l.lineId)));
 const calc=visible.map(r=>{
  const e=withCustomerNames(r.evidence,customerNames),links=e.links||[];
  const revenues=links.map(l=>{const row=orderLines.find(x=>x.id===l.lineId);const sameUnit=String(row?.unita_misura_oct||"").toUpperCase()===String(l.unit||"").toUpperCase()&&Boolean(l.unit);return row&&sameUnit&&Number(row.quantita)>0&&number(row.imponibile_riga)!==null?Number(row.imponibile_riga)*Number(l.quantity)/Number(row.quantita):null;});
  const matches=allowedAllocations.filter(a=>a.mes_order_id===r.mes_order_id).map(a=>{
   const l=invoiceLines.find(x=>String(x.id)===String(a.invoice_line_id)),h=invoiceHeaders.find(x=>x.id===l?.fattura_id);
   const sign=h?.sigla?.toUpperCase()==="NC"?-1:1;
   return {...a,document:h,line:l,quantity:sign*Number(a.quantity),amount:l&&h&&number(l.valore_netto)!==null?sign*Math.abs(Number(l.valore_netto))*Number(a.quantity)/Math.abs(Number(l.quantita)):null};
  });
  const commercial={octRevenue:sumKnown(revenues)??legacyOrderRevenue(e,visible.map(x=>x.evidence)),invoiceRevenue:sumKnown(matches.map(x=>x.amount)),invoicedQuantity:matches.length?matches.reduce((s,x)=>s+x.quantity,0):null,invoices:matches};
  const audit=adjustments.filter(a=>a.mes_order_id===r.mes_order_id);
  const overrideId=!e.baseline?audit.find(a=>a.details?.configurationId)?.details.configurationId:null;
  const config=configs.find(c=>c.id===overrideId)||configs.find(c=>c.id===r.configuration_id)||configurationFor(e,configs);
  return {...calculateRecord(e,config,audit.find(x=>x.details?.washes)?.details||{},commercial),audit,refreshedAt:r.refreshed_at};
 });
 return {records:allocateBulkCosts(calc),canWrite:session.canWrite,configurationsAvailable:configs.length};
}
