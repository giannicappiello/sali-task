import {createHash} from 'node:crypto';
import {buildMexalClient} from '../mexal/sync-products.js';
import {inventorySource} from '../second-brain/mexal-inventory.js';
import {inventoryMovement} from '../second-brain/mexal-inventory-model.js';
import {businessWindow,POLICY} from './engine.js';
const fail=(message,status=503)=>Object.assign(Error(message),{status});
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const checked=r=>{if(r.error)throw fail('Fonte Workspace non leggibile.');return r.data;};
const day=x=>typeof x==='string'?x.slice(0,10):null;
const unit=x=>String(x||'').trim().toUpperCase().replaceAll('.','');
const numeric=x=>typeof x==='number'&&Number.isFinite(x);
const getAllowed=(help,path,method='GET')=>{
 let found=false;const walk=x=>{if(!x||typeof x!=='object')return;if(x.method===method&&typeof x.regexp==='string'){try{if(new RegExp(x.regexp).test(path))found=true;}catch{/* invalid descriptors are not capabilities */}}Object.values(x).forEach(walk);};walk(help);return found;
};
export async function assertScheduledOwner(db,id){
 if(!id)throw fail('Titolare del piano non configurato.',403);
 const owner=checked(await db.from('utenti').select('id,auth_user_id,attivo,ruoli(amministratore_workspace)').eq('id',id).maybeSingle());
 if(!owner||owner.attivo===false||owner.ruoli?.amministratore_workspace!==true)throw fail('Titolare del controllo non più autorizzato.',403);
 for(const module of ['anomalie','progremes','magazzino'])if(checked(await db.rpc('workspace_module_enabled_for_user',{target_user_id:id,target_module:module}))!==true)throw fail('Permesso di fonte revocato al titolare.',403);
 return owner;
}
export async function readMesControlSource({fetchImpl=fetch,env=globalThis.process.env}={}){
 const base=String(env.PROGREMES_URL||''),secret=String(env.PROGREMES_INTEGRATION_SECRET||'');
 if(!base.startsWith('https://')||!secret)throw fail('Collegamento MES non configurato.');
 const r=await fetchImpl(new URL('/api/workspace/v1/fabbisogni-control-source',base),{method:'GET',redirect:'error',headers:{Accept:'application/json','X-Workspace-Secret':secret},signal:AbortSignal.timeout(180000)});
 if(r.status===404)throw fail('Aggiornare MES: manca il contratto di controllo Fabbisogni in sola lettura.',409);
 if(!r.ok)throw fail('Lettura del controllo MES non riuscita.');
 const s=await r.json();
 if(s.contractVersion!==1||s.readOnly!==true||s.source!=='ProgreMES.APS'||!s.planning||s.purchasing?.contractVersion!==4||!Array.isArray(s.inventory)||!Array.isArray(s.supplierLines)||!Array.isArray(s.reservations)||!Array.isArray(s.resources)||!Array.isArray(s.quality)||!Array.isArray(s.sync))throw fail('Contratto di controllo MES non valido.');
 return s;
}
export async function readWarehouseRows(db){
 const rows=[];for(let offset=0;offset<100000;offset+=1000){const page=checked(await db.from('workspace_warehouse_stock').select('article_code,warehouse_number,unit_of_measure,on_hand,committed,available,synchronized_at').eq('is_current',true).order('article_code').order('warehouse_number').range(offset,offset+999));rows.push(...page);if(page.length<1000)return rows;}throw fail('Copertura magazzino Workspace oltre il limite di lettura.');
}
export function sparseProgressives(payload,warehouse){
 if(!payload||!Number.isSafeInteger(payload.num_prog_art)||!Array.isArray(payload.cod_articolo))throw fail('Progressivi Mexal non riconosciuti.');
 const rows=new Map();
 for(const field of ['cod_articolo','id_magazzino','id_lotto','qta_inventario','qta_carico','qta_scarico']){
  if(!Array.isArray(payload[field]))throw fail('Campo progressivi mancante: '+field);
  for(const tuple of payload[field]){if(!Array.isArray(tuple)||tuple.length!==2||!Number.isInteger(tuple[0]))throw fail('Matrice progressivi non valida.');const row=rows.get(tuple[0])||{};row[field]=tuple[1];rows.set(tuple[0],row);}
 }
 if(rows.size!==payload.num_prog_art)throw fail('Copertura progressivi incompleta.');
 return [...rows.values()].map(r=>{
  const wh=r.id_magazzino??warehouse;if(wh!==warehouse||typeof r.cod_articolo!=='string')throw fail('Magazzino o articolo progressivi non coerente.');
  const quantities=['qta_inventario','qta_carico','qta_scarico'].map(k=>r[k]??0);if(!quantities.every(numeric))throw fail('Quantità Mexal non verificabile.');
  return {article:r.cod_articolo.trim().toUpperCase(),warehouse:String(wh),mexalLotId:r.id_lotto>0?r.id_lotto:null,onHand:quantities[0]+quantities[1]-quantities[2]};
 });
}
export async function readMexalEvidence({window,warehouses,clientForWarehouse=w=>buildMexalClient({year:Number(window.from.slice(0,4)),warehouse:w,timeoutMs:90000})}){
 const client=clientForWarehouse(null),help=await client.getJson('/help');
 if(!getAllowed(help,'/progressivi-articoli'))throw fail('Progressivi magazzino non pubblicati dal catalogo Mexal.');
 const progressives=[];
 for(const warehouse of warehouses){let next=null;const seen=new Set();const c=clientForWarehouse(warehouse);
  for(let page=0;page<100;page++){
   const q=new URLSearchParams({max:'1000',fields:'cod_articolo,id_magazzino,id_lotto,qta_inventario,qta_carico,qta_scarico'});if(next)q.set('next',next);
   const raw=await c.getJson('/progressivi-articoli?'+q);progressives.push(...sparseProgressives(raw,warehouse));next=raw.next||null;
   if(!next)break;if(page===99||seen.has(next))throw fail('Paginazione progressivi Mexal incompleta.');seen.add(next);
  }
 }
 const path='/documenti/movimenti-magazzino/righe/ricerca';let movements=[],movementGap=null;
 if(!getAllowed(help,path,'POST'))movementGap='Ricerca in sola lettura dei movimenti non pubblicata.';
 else try{
  const source=await inventorySource(client,path,{fields:'sigla,serie,numero,cod_conto,data_documento,id_riga,id_rif_testata,codice_articolo,id_causale_riga,id_ncau_riga,id_mag_da_riga,id_mag_a_riga,tp_um_articolo,quantita,coeff_conv,sigla_doc_orig,data_doc_orig',filter:{campo:'data_documento',condizione:'=',valore:window.yesterday.replaceAll('-','')},maxPages:30,maxRows:30000});
  if(source.rows.some(r=>r.data_documento!==window.yesterday.replaceAll('-','')))throw fail('Il filtro della data non è stato rispettato da Mexal.');movements=source.rows;
 }catch(e){movementGap=e.status?e.message:'Archivio movimenti Mexal non leggibile.';}
 return {progressives,movements,movementGap,readAt:new Date().toISOString()};
}
export function analyzeControlSource(source,{workspaceStock=[],mexal=null,departments=[],now=new Date()}={}){
 const window=businessWindow(now),findings=[],gaps=[],coverage={},resources=new Map(source.resources.map(x=>[x.id,x]));
 const add=(category,severity,identity,title,evidence={},departmentId=null)=>findings.push({agent_code:'fabbisogni',fingerprint:digest([POLICY.version,category,identity]),category,severity,title,description:title,department_id:departmentId,source_modules:['progremes','magazzino'],evidence});
 const gap=(name,reason)=>{coverage[name]={complete:false,readAt:source.generatedAtUtc,reason};if(!gaps.some(g=>g.source===name))gaps.push({source:name,reason});};
 const ok=name=>coverage[name]={complete:true,readAt:source.generatedAtUtc};
 const rawTasks=source.planning.version?.snapshot?.tasks;
 if(!Array.isArray(rawTasks))throw fail('Il planning operativo non contiene il contratto delle fasi.');
 const tasks=rawTasks.filter(t=>[0,3,7,'Production','Packaging','Cartoning'].includes(t.type)&&!['Completed',2,'CANCELLED'].includes(t.status)&&day(t.start)<window.toExclusive&&day(t.end)>=window.from);
 const plannedIds=new Set(tasks.map(t=>t.orderId));
 const departmentFor=orderId=>{
  const names=[...new Set(tasks.filter(t=>t.orderId===orderId).map(t=>resources.get(t.resourceId)?.department).filter(Boolean))];
  const ids=departments.filter(d=>names.some(n=>String(d.nome).trim().toLowerCase()===String(n).trim().toLowerCase())).map(d=>d.id);
  return ids.length===1?ids[0]:null;
 };
 ok('planning');
 const demands=source.purchasing.demands||[],stocks=new Map((source.purchasing.stocks||[]).map(x=>[x.articleId,x.availableQuantity]));
 const warnings=source.purchasing.warnings||[];
 if(warnings.length)gap('bom',warnings.slice(0,10).join(' · '));else ok('bom');
 for(const id of plannedIds)if(!demands.some(d=>d.productionOrderId===id)){add('bom','high',id,'Formula o distinta dei materiali non verificabile per la lavorazione pianificata',{jobId:id},departmentFor(id));gap('bom','Una o più lavorazioni pianificate non hanno materiali verificabili.');}
 const allEvaluated=new Set(demands.map(d=>d.productionOrderId));
 for(const r of source.reservations)if(!plannedIds.has(r.orderId)&&allEvaluated.has(r.orderId)&&numeric(r.quantity))stocks.set(r.articleId,Math.max(0,(stocks.get(r.articleId)||0)-r.quantity));
 ok('stock');ok('purchaseOrders');ok('requirements');
 const supplies=source.purchasing.arrivals||[],byArticle=new Map();
 for(const demand of demands){if(!numeric(demand.quantity)||demand.quantity<0||!demand.unitOfMeasure){gap('bom','Quantità o UM mancante nella distinta.');continue;}const group=byArticle.get(demand.articleId)||[];group.push(demand);byArticle.set(demand.articleId,group);}
 for(const [articleId,articleDemands]of byArticle){
  articleDemands.sort((a,b)=>String(a.requiredAt).localeCompare(String(b.requiredAt))||b.priority-a.priority);
  const arrivals=supplies.filter(x=>x.articleId===articleId&&numeric(x.residualQuantity)&&x.residualQuantity>0).sort((a,b)=>String(a.expectedAt).localeCompare(String(b.expectedAt)));
  let available=stocks.get(articleId)??0,ordered=available,index=0;
  if(!numeric(available)){gap('stock','Disponibilità di uno o più materiali assente nella fonte MES.');continue;}
  ordered+=arrivals.reduce((n,a)=>n+a.residualQuantity,0);
  for(const d of articleDemands){
   while(index<arrivals.length&&day(arrivals[index].expectedAt)<=day(d.requiredAt))available+=arrivals[index++].residualQuantity;
   const shortage=Math.max(0,d.quantity-Math.max(0,available)),purchaseMissing=Math.max(0,d.quantity-Math.max(0,ordered));available-=d.quantity;ordered-=d.quantity;
   if(!plannedIds.has(d.productionOrderId)||day(d.requiredAt)>=window.toExclusive)continue;
   const dept=departmentFor(d.productionOrderId),id=[d.productionOrderId,articleId,day(d.requiredAt)],evidence={jobId:d.productionOrderId,orderNumber:d.productionOrderNumber,article:d.articleCode,unit:unit(d.unitOfMeasure),required:d.quantity,requiredAt:d.requiredAt,shortage,basis:'MES official purchasing source; external reservations excluded; supplier arrivals net of external allocations'};
   if(shortage>0)add('material_shortage','high',id,'Materiale insufficiente alla data del planning',evidence,dept);
   if(purchaseMissing>0)add(purchaseMissing<shortage?'purchase_partial':'purchase_missing','high',id,'Ordine fornitore mancante o parziale rispetto al fabbisogno',{...evidence,quantityToOrder:purchaseMissing},dept);
   if(shortage>0&&arrivals.some(a=>day(a.expectedAt)>day(d.requiredAt)))add('delivery_incompatible','high',id,'Consegna fornitore successiva alla necessità del planning',evidence,dept);
   const registered=(source.planningState?.releaseShortages||[]).filter(x=>x.orderId===d.productionOrderId&&x.code===d.articleCode&&!x.cancelled).reduce((n,x)=>n+(numeric(x.quantity)?x.quantity:0),0);
   if(shortage>0&&registered<shortage)add('requirement_missing','warning',id,'Carenza da confrontare con i fabbisogni generati',{...evidence,registeredShortage:registered,provisionalDocuments:(source.purchasing.existingPf||[]).filter(x=>x.articleId===articleId).map(x=>x.documentNumber)},dept);
  }
 }
 const relevantArticles=new Set(demands.filter(d=>plannedIds.has(d.productionOrderId)).map(d=>d.articleCode));
 for(const line of source.supplierLines)if(relevantArticles.has(line.article)&&numeric(line.ordered)&&numeric(line.received)&&line.ordered>line.received&&!line.expectedAtLocal)add('delivery_missing','warning',line.id,'Ordine fornitore aperto senza data di consegna',{purchaseOrderLineId:line.id,orderNumber:line.number,article:line.article,remaining:line.ordered-line.received});
 ok('quality');for(const q of source.quality)if(plannedIds.has(q.orderId)&&['NonConforme','Rifiutato'].includes(q.conformity)||plannedIds.has(q.orderId)&&q.release==='Rifiutata')add('quality_block','high',q.id,'Controllo qualità o delibera non conforme',{jobId:q.orderId,productionId:q.id,conformity:q.conformity,release:q.release},departmentFor(q.orderId));
 // Detect actual overlap using the same working intervals displayed by the MES.
 ok('capacity');const intervals=[];
 for(const task of tasks){const segments=task.workingIntervals?.length?task.workingIntervals:[{start:task.start,end:task.end}];for(const s of segments)if(s.start&&s.end&&s.start<s.end)intervals.push({resourceId:task.resourceId,orderId:task.orderId,start:s.start,end:s.end});}
 intervals.sort((a,b)=>String(a.start).localeCompare(String(b.start)));
 for(let i=0;i<intervals.length;i++)for(let j=i+1;j<intervals.length&&intervals[j].start<intervals[i].end;j++)if(intervals[i].resourceId===intervals[j].resourceId&&intervals[i].orderId!==intervals[j].orderId)add('capacity','high',[intervals[i].resourceId,intervals[i].orderId,intervals[j].orderId,day(intervals[i].start)],'Sovrapposizione di lavorazioni sulla stessa risorsa',{first:intervals[i],second:intervals[j]},departmentFor(intervals[i].orderId));
 if(!mexal)gap('movements','Lettura diretta Mexal non disponibile.');else if(mexal.movementGap)gap('movements',mexal.movementGap);else ok('movements');
 const receipts=[];if(mexal&&!mexal.movementGap){for(const row of mexal.movements){try{const movement=inventoryMovement(row);if(movement.date!==window.yesterday.replaceAll('-',''))continue;for(const effect of movement.effects)if(effect.field==='carico'&&effect.amount>0n)receipts.push({article:row.codice_articolo,warehouse:effect.warehouse,quantity:Number(effect.amount)/1e6,document:[row.sigla,row.serie,row.numero].join('/'),lot:null});}catch(e){gap('movements',e.message);}}
  coverage.receipts={complete:true,readAt:mexal.readAt,reason:`${receipts.length} righe di ricevimento fisico del giorno precedente; lotti e qualità richiedono collegamento documentale.`};
  for(const receipt of receipts)add('receipt_quality','warning',[receipt.document,receipt.article,receipt.warehouse],'Ricevimento di ieri: verificare lotto e rilascio qualità',receipt);
 }else gap('receipts','Ricevimenti del giorno precedente non verificabili senza movimenti Mexal completi.');
 // All three source projections are retained. Do not equate aggregated Workspace
 // stock, signed Mexal lot balances and positive operational MES lots.
 const reconciliation=[];
 if(mexal){for(const ws of workspaceStock.filter(w=>relevantArticles.has(w.article_code))){
  const mexalRows=mexal.progressives.filter(r=>r.article===ws.article_code&&r.warehouse===String(ws.warehouse_number));
  const mesRows=source.inventory.filter(r=>r.article===ws.article_code&&String(r.warehouse)===String(ws.warehouse_number));
  if(!mexalRows.length||!mesRows.length)continue;
  const quantities={mexalSigned:mexalRows.reduce((n,r)=>n+r.onHand,0),mexalPositiveLots:mexalRows.reduce((n,r)=>n+Math.max(0,r.onHand),0),mesOperational:mesRows.reduce((n,r)=>n+r.onHand,0),workspaceAggregate:ws.on_hand};
  const entry={article:ws.article_code,warehouse:ws.warehouse_number,unit:unit(ws.unit_of_measure),quantities,lotComparison:mesRows.map(r=>({lot:r.lot,mexalLotId:r.mexalLotId,onHand:r.onHand,mexalRows:mexalRows.filter(m=>m.mexalLotId===r.mexalLotId)})),workspaceUpdatedAt:ws.synchronized_at,mesUpdatedAt:mesRows.map(r=>r.updatedAtLocal),mexalReadAt:mexal.readAt,classification:'synchronization_cutoff_unverified'};
  reconciliation.push(entry);
  if(Math.abs(quantities.mexalPositiveLots-quantities.mesOperational)>0.000001||Math.abs(quantities.mexalSigned-quantities.workspaceAggregate)>0.000001)add('stock_reconciliation','warning',[entry.article,entry.warehouse],'Giacenze da riconciliare dopo verifica della sincronizzazione',entry);
 }}
 gap('stock_reconciliation','Confronto delle tre fonti acquisito; mancano un cutoff transazionale comune e il dettaglio lotto Workspace. Le differenze sono da verificare, non errori contabili presunti.');
 const affected=new Set(findings.filter(x=>['material_shortage','quality_block','capacity'].includes(x.category)).map(x=>x.evidence.jobId??x.evidence.first?.orderId).filter(Boolean));
 for(const task of tasks){const previous=rawTasks.find(t=>t.id===task.previousTaskId);if(previous&&affected.has(previous.orderId)&&!affected.has(task.orderId)){affected.add(task.orderId);add('cascade','warning',[previous.orderId,task.orderId],'Possibile impatto da una lavorazione precedente',{jobId:task.orderId,predecessor:previous.orderId},departmentFor(task.orderId));}}
 for(const g of gaps)add('data_unavailable','warning',g.source,'Controllo con dati da verificare: '+g.source,{source:g.source,reason:g.reason});
 return {window,status:gaps.length?'incomplete':'complete',findings,coverage,gaps,reconciliation,receipts,plannedOrders:plannedIds.size,departmentIds:departments.map(x=>x.id),evidenceHash:digest({source,workspaceStock,mexal}),policyVersion:POLICY.version};
}
export async function collectControlSnapshot(db,ownerId,{now=new Date(),mesReader=readMesControlSource,mexalReader=readMexalEvidence}={}){
 await assertScheduledOwner(db,ownerId);const window=businessWindow(now);
 const [source,workspaceStock,departments]=await Promise.all([mesReader(),readWarehouseRows(db),db.from('reparti').select('id,nome').eq('attivo',true).then(checked)]);
 const warehouses=[...new Set(source.inventory.map(x=>x.warehouse))].filter(x=>Number.isInteger(x)&&x>0);
 let mexal=null;try{mexal=await mexalReader({window,warehouses});}catch{/* the report explicitly records unavailable Mexal coverage */}
 return {kind:'analyzed-control-source',...analyzeControlSource(source,{workspaceStock,mexal,departments,now})};
}
