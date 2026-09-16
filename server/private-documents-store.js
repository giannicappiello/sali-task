/* global process */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { buildMexalClient } from './mexal/sync-products.js';

const value = v => String(v ?? '').trim();
export const key = v => value(v).toUpperCase();
const fail = (message, status=400) => Object.assign(new Error(message), {status});
const primaryKeys={ordini_prodotti_cache:'codice_articolo',workspace_private_documents:'external_id',
  workspace_sl_genealogy:'mes_id',workspace_private_document_lots:'mexal_id',workspace_private_nas_files:'path_key',documenti_workspace:'id'};
export async function rows(admin, table, select='*', filter=q=>q) {
  const page=async(offset,count=false)=>{
    const query=filter(admin.from(table).select(select,count?{count:'exact'}:undefined));
    const result=await query.order(primaryKeys[table]||'id').range(offset,offset+999);
    if(result.error) throw result.error;
    return result;
  };
  const first=await page(0,true), result=[...first.data];
  if(first.data.length===1000&&!Number.isInteger(first.count)) throw fail('Conteggio archivio non disponibile: lettura interrotta.',502);
  // Stable ordering and bounded parallel pages avoid one round trip per 1,000 lots.
  for(let offset=1000;offset<(first.count??first.data.length);offset+=4000) {
    const pages=await Promise.allSettled([0,1000,2000,3000].filter(n=>offset+n<first.count).map(n=>page(offset+n)));
    for(const item of pages) {if(item.status==='rejected') throw item.reason;result.push(...item.value.data);}
  }
  return result;
}
async function save(admin, table, data, options) {
  for(let i=0;i<data.length;i+=300) {
    const {error}=await admin.from(table).upsert(data.slice(i,i+300),options);
    if(error) throw error;
  }
}
export function gatewayUrl(pathname) {
  const base=value(process.env.DOCUMENT_GATEWAY_URL).replace(/\/$/,'');
  const secret=value(process.env.DOCUMENT_GATEWAY_SECRET);
  if(!base||secret.length<32) throw fail('Connettore NAS Workspace non configurato.',503);
  const expires=Math.floor(Date.now()/1000)+900;
  const signature=createHmac('sha256',secret).update(`${pathname}\n${expires}`).digest('hex');
  return `${base}${pathname}?expires=${expires}&signature=${signature}`;
}
export function normalizePath(path) {
  const p=value(path).replaceAll('\\','/');
  if(!p||p.startsWith('/')||p.includes(':')||p.split('/').some(x=>!x||x==='.'||x==='..')||[...p].some(c=>c.charCodeAt(0)<32))
    throw fail('Percorso NAS non valido.');
  return p;
}
export function matchFile(file, articles, lots) {
  const parts=normalizePath(file.path).split('/');
  if(key(parts[0])!=='PRODUZIONE'||!['DOCUMENTAZIONE MP','COAPROGRE'].includes(key(parts[1]))||parts.length<4)
    return {reason:'Fuori dalle cartelle Produzione/Documentazione MP e Produzione/CoaPROGRE: associazione manuale.'};
  const article=articles.find(a=>key(a.articleCode)===key(parts[2]));
  const production=article&&['ProdottoFinito','Semilavorato'].includes(article.articleType);
  if(!article||production!==(key(parts[1])==='COAPROGRE')) return {reason:'Cartella non corrispondente alla tipologia articolo di Workspace.'};
  const stem=key(parts.at(-1).replace(/\.[^.]+$/,''));
  const code=key(article.articleCode);
  if(stem===code||stem.startsWith(code+'_')) return {articleCode:article.articleCode,lotCode:''};
  const candidates=[...new Set(lots.filter(l=>key(l.articleCode)===code).map(l=>key(l.lotCode)).filter(Boolean))]
    .filter(l=>stem===l||stem.startsWith(l+'_'));
  // A complete lot name wins over a shorter prefix (lot numbers can contain underscores).
  const exact=candidates.filter(l=>stem===l);
  const matches=exact.length?exact:candidates;
  if(matches.length===1) return {articleCode:article.articleCode,lotCode:matches[0]};
  if(matches.length) return {reason:'Nome ambiguo tra più lotti: verificare il collegamento.'};
  if(production&&/^\d+(?:_|$)/.test(stem)) return {reason:'Numero di lotto non presente per questo articolo: verificare il lotto e sincronizzare.'};
  return {articleCode:article.articleCode,lotCode:''};
}
export function articleType(code, hasBom) {
  if(key(code).startsWith('MP')) return 'MateriaPrima';
  if(key(code).startsWith('FP')) return 'Semilavorato';
  return hasBom==='S'||/^(IT|DC|CO|BT|DD|CW|DR)/i.test(code)?'ProdottoFinito':'Packaging';
}
export async function readArchive(admin, articleCode=null) {
  const byCode=column=>q=>articleCode?q.eq(column,column==='article_code'?key(articleCode):articleCode):q;
  const genealogyFilter=q=>articleCode?q.or(`codice_articolo_prodotto.eq.${JSON.stringify(articleCode)},codice_articolo_materia_prima.eq.${JSON.stringify(articleCode)}`):q;
  const [catalog,documents,genealogy,lotRows,files,genericDocuments]=await Promise.all([
    rows(admin,'ordini_prodotti_cache','codice_articolo,descrizione,unita_misura,has_bom:dati_mexal->>gest_dbp',byCode('codice_articolo')),
    rows(admin,'workspace_private_documents','*',byCode('codice_articolo')),rows(admin,'workspace_sl_genealogy','*',genealogyFilter),
    rows(admin,'workspace_private_document_lots','article_code,lot_code,customer_code',byCode('article_code')),rows(admin,'workspace_private_nas_files'),
    articleCode?Promise.resolve([]):rows(admin,'documenti_workspace','percorso,prodotto_id,attivo')]);
  const lots=lotRows.map(l=>({articleCode:l.article_code,lotCode:l.lot_code,customerCode:l.customer_code,source:'Mexal'}));
  for(const g of genealogy) {
    if(g.lotto_origine) lots.push({articleCode:g.codice_articolo_materia_prima,lotCode:g.lotto_origine,source:'SL'});
    if(g.lotto_destinazione) lots.push({articleCode:g.codice_articolo_prodotto,lotCode:g.lotto_destinazione,customerCode:g.codice_cliente,
      productionOrderId:g.ordine_produzione_mes_id,productionOrderNumber:g.numero_ordine_produzione,source:'SL'});
  }
  const articles=catalog.map(a=>({articleId:a.codice_articolo,articleCode:a.codice_articolo,description:a.descrizione,
    articleType:articleType(a.codice_articolo,a.has_bom),unitOfMeasure:a.unita_misura}));
  const lotsByArticle=new Map(),documentsByArticle=new Map();
  for(const lot of lots) {
    const code=key(lot.articleCode);
    if(!lotsByArticle.has(code)) lotsByArticle.set(code,[]);
    lotsByArticle.get(code).push(lot);
  }
  for(const document of documents) {
    const code=key(document.codice_articolo);
    if(!documentsByArticle.has(code)) documentsByArticle.set(code,[]);
    documentsByArticle.get(code).push(document);
  }
  const activeFiles=new Set(files.filter(f=>f.active).map(f=>key(f.path)));
  return {articles,documents,genealogy,lots,files,genericDocuments,lotsByArticle,documentsByArticle,activeFiles};
}
export function allowedLots(archive, code, customerCodes) {
  const internal=customerCodes.includes('*');
  const candidates=archive.lotsByArticle?(archive.lotsByArticle.get(key(code))||[]):archive.lots;
  return candidates.filter(l=>key(l.articleCode)===key(code)&&(internal||customerCodes.includes(value(l.customerCode))));
}
export function visibleDocuments(archive, code, customerCodes) {
  const internal=customerCodes.includes('*');
  const lots=internal?[]:allowedLots(archive,code,customerCodes);
  if(!internal&&!lots.length) return [];
  const activeFiles=archive.activeFiles||new Set(archive.files.filter(f=>f.active).map(f=>key(f.path)));
  const candidates=archive.documentsByArticle?(archive.documentsByArticle.get(key(code))||[]):archive.documents;
  return candidates.filter(d=>d.attivo&&key(d.codice_articolo)===key(code)&&d.percorso_nas&&activeFiles.has(key(d.percorso_nas))
    &&(internal||!d.codice_lotto||lots.some(l=>key(l.lotCode)===key(d.codice_lotto))));
}
export function documentDto(d) {
  return {externalId:d.external_id,title:d.titolo,type:d.tipo,revision:d.revisione,language:d.lingua,
    originalFileName:d.nome_file_originale,sizeBytes:d.dimensione_byte,uploadedAt:d.caricato_il,
    associationType:d.tipo_associazione,articleId:d.codice_articolo,lotCode:d.codice_lotto,active:d.attivo};
}
export function unassociated(archive) {
  const linked=new Set(archive.documents.filter(d=>d.attivo&&d.codice_articolo&&d.percorso_nas).map(d=>key(d.percorso_nas)));
  for(const doc of archive.genericDocuments||[]) if(doc.attivo&&doc.prodotto_id) linked.add(key(doc.percorso));
  return archive.files.filter(f=>f.active&&!linked.has(key(f.path))).map(f=>({relativePath:f.path,name:f.name,sizeBytes:f.size_bytes,
    reason:matchFile(f,archive.articles,archive.lots).reason||'In attesa di sincronizzazione.'}));
}
export async function syncLots(admin, {client=buildMexalClient({warehouse:null,timeoutMs:15000})}={}) {
  const result=[],seen=new Set(); let next=null;
  const deadline=Date.now()+90000;
  do {
    if(Date.now()>deadline) throw fail('Lettura lotti incompleta: conservato l’ultimo elenco Workspace.',503);
    const params=new URLSearchParams({max:'1000',fields:'id,cod_ute_lotto,cod_articolo,cod_fornitore'});
    if(next) params.set('next',next);
    const payload=await client.getJson('/lotti?'+params);
    if(!Array.isArray(payload.dati)) throw fail('Risposta lotti non valida.',502);
    result.push(...payload.dati.filter(l=>l.id&&value(l.cod_articolo)&&value(l.cod_ute_lotto)).map(l=>({
      mexal_id:l.id,article_code:key(l.cod_articolo),lot_code:value(l.cod_ute_lotto),
      customer_code:value(l.cod_fornitore).startsWith('501.')?value(l.cod_fornitore):null,synchronized_at:new Date().toISOString()})));
    next=payload.next||null;
    if(next&&seen.has(next)) throw fail('Paginazione lotti incompleta.',502);
    seen.add(next);
  } while(next);
  await save(admin,'workspace_private_document_lots',result,{onConflict:'mexal_id'});
  return result.length;
}
function linkId(path,code,lot) {
  const h=createHash('sha256').update(JSON.stringify([key(path),key(code),key(lot)])).digest('hex').slice(0,32);
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20)}`;
}
export function linkRow(file, match, input={}, user='Workspace', now=new Date().toISOString()) {
  return {external_id:linkId(file.path,match.articleCode,match.lotCode),codice_articolo:match.articleCode,percorso_nas:file.path,
    codice_lotto:match.lotCode||'',tipo_associazione:match.lotCode?'LottoMateriaPrima':'Articolo',
    tipo:input.documentType||(/sds|_ss/i.test(file.name)?'Sds':/_st/i.test(file.name)?'SchedaTecnica':'Altro'),
    titolo:value(input.title)||file.name,revisione:value(input.revision)||'1',lingua:value(input.language)||'IT',
    nome_file_originale:file.name,content_type:'application/octet-stream',dimensione_byte:file.size_bytes??file.size??0,
    caricato_da:user,caricato_il:now,attivo:true,origine:user==='Workspace'?'automatica':'manuale',
    valido_al:input.validUntil||null,note:value(input.notes)||null,sincronizzato_il:now};
}
export async function synchronizeNas(admin,{force=false,fetchManifest=async()=>{
  const response=await fetch(gatewayUrl('/manifest'),{signal:AbortSignal.timeout(60000)});
  if(!response.ok) throw fail(`Archivio NAS Workspace non disponibile (${response.status}).`,502);
  return response.json();
},refreshLots=syncLots}={}) {
  const owner=randomUUID();
  const {data:claimed,error}=await admin.rpc('claim_private_document_sync',{owner_id:owner,force_sync:force});
  if(error) throw error;
  if(!claimed) {
    if(force) throw fail('Sincronizzazione documenti già in corso. Attendere e aggiornare l’archivio.',409);
    return {status:'not_due_or_running'};
  }
  try {
    const manifest=await fetchManifest();
    if(!Array.isArray(manifest.files)||manifest.complete===false||manifest.files.length>=50000)
      throw fail('Elenco NAS incompleto: conservato l’archivio precedente.',502);
    const stamp=new Date().toISOString(), warnings=[];
    try {await refreshLots(admin);} catch {warnings.push('Aggiornamento lotti non disponibile: associazioni verificate sui lotti già presenti in Workspace.');}
    const archive=await readArchive(admin);
    const files=manifest.files.map(f=>({path_key:key(normalizePath(f.path)),path:normalizePath(f.path),name:f.name||f.path.split('/').at(-1),
      size_bytes:f.size||0,modified_at:f.modifiedAt||null,active:true,scanned_at:stamp}));
    if(new Set(files.map(f=>f.path_key)).size!==files.length) throw fail('Percorsi NAS duplicati: sincronizzazione interrotta.',502);
    await save(admin,'workspace_private_nas_files',files,{onConflict:'path_key'});
    const linked=new Set(archive.documents.filter(d=>d.attivo&&d.percorso_nas).map(d=>key(d.percorso_nas)));
    const links=[];
    for(const f of files) {
      if(linked.has(key(f.path))) continue;
      const match=matchFile(f,archive.articles,archive.lots);
      if(match.articleCode) {
        const row=linkRow(f,match,{},'Workspace',stamp);
        const type=archive.articles.find(a=>a.articleCode===match.articleCode)?.articleType;
        if(match.lotCode) row.tipo_associazione=type==='Semilavorato'?'LottoBulk':type==='ProdottoFinito'?'LottoProdotto':'LottoMateriaPrima';
        links.push(row);
      }
    }
    await save(admin,'workspace_private_documents',links,{onConflict:'external_id',ignoreDuplicates:true});
    const {error:inactiveError}=await admin.from('workspace_private_nas_files').update({active:false}).lt('scanned_at',stamp);
    if(inactiveError) throw inactiveError;
    const {error:finishError}=await admin.from('workspace_private_document_sync').update({last_success:stamp,warnings}).eq('id',1).eq('lease_owner',owner);
    if(finishError) throw finishError;
    return {status:'success',scannedAt:stamp,associated:links.length,warnings,
      unassociated:unassociated({...archive,files,documents:[...archive.documents,...links]})};
  } finally {
    const {error:releaseError}=await admin.from('workspace_private_document_sync').update({lease_until:null,lease_owner:null}).eq('id',1).eq('lease_owner',owner);
    if(releaseError) console.error('Private document sync: lease release failed; automatic expiration will release it.');
  }
}

export async function privateDocumentOperation(identity, path, input={}) {
  const {admin,customerCodes,profile}=identity;
  const internal=customerCodes.includes('*');
  const url=new URL(path,'https://workspace.invalid/');
  if(url.pathname==='/lots/documents') return productionLotDocuments(admin,value(url.searchParams.get('articleCode')),url.searchParams.get('all')==='true'?null:value(url.searchParams.get('lotCode')),customerCodes);
  if(url.pathname.startsWith('/documents/')&&url.pathname!=='/documents/reference'&&url.searchParams.has('articleCode')) {
    const bundle=await productionLotDocuments(admin,value(url.searchParams.get('articleCode')),value(url.searchParams.get('lotCode')),customerCodes);
    const id=url.pathname.slice('/documents/'.length);
    const document=[...bundle.general,...bundle.specific,...bundle.materials.flatMap(m=>m.documents)].find(d=>d.externalId===id);
    if(!document) throw fail('Documento non disponibile per questo lotto.',404);
    const {data,error}=await admin.from('workspace_private_documents').select('percorso_nas').eq('external_id',id).single();
    if(error) throw error;
    const {error:auditError}=await admin.from('workspace_private_document_access_log').insert({user_id:profile.id,document_id:id});
    if(auditError) throw auditError;
    return {url:gatewayUrl('/files/'+normalizePath(data.percorso_nas).split('/').map(encodeURIComponent).join('/'))};
  }
  if(url.pathname==='/nas/sync') return synchronizeNas(admin,{force:true});
  if(url.pathname==='/nas') {
    if(!internal) throw fail('Operazione riservata agli utenti interni.',403);
    const dir=value(url.searchParams.get('directory'));
    const prefix=dir?normalizePath(dir)+'/':'';
    const dirs=new Map(),files=[];
    for(const f of (await rows(admin,'workspace_private_nas_files')).filter(f=>f.active&&f.path.startsWith(prefix))) {
      const parts=f.path.slice(prefix.length).split('/');
      if(parts.length>1) dirs.set(parts[0],{name:parts[0],relativePath:prefix+parts[0]});
      else files.push({name:f.name,relativePath:f.path,sizeBytes:f.size_bytes});
    }
    return {parentPath:dir?dir.split('/').slice(0,-1).join('/'):null,directories:[...dirs.values()],files};
  }
  let code=url.pathname.startsWith('/articles/')?decodeURIComponent(url.pathname.slice('/articles/'.length)):null;
  if(url.pathname==='/documents/reference') code=value(input.articleId);
  if(url.pathname.startsWith('/documents/')&&url.pathname!=='/documents/reference') {
    const {data,error}=await admin.from('workspace_private_documents').select('codice_articolo').eq('external_id',url.pathname.slice('/documents/'.length)).maybeSingle();
    if(error) throw error;
    if(!data?.codice_articolo) throw fail('Documento non disponibile.',404);
    code=data.codice_articolo;
  }
  const archive=await readArchive(admin,code);
  const needsArticles=url.pathname.startsWith('/articles')||url.pathname==='/documents/reference';
  const articles=needsArticles?catalogue(archive,customerCodes):[];
  if(url.pathname==='/articles') {
    const term=key(url.searchParams.get('search'));
    return articles.filter(a=>!term||a.searchText.includes(term));
  }
  if(url.pathname.startsWith('/articles/')) {
    const code=decodeURIComponent(url.pathname.slice('/articles/'.length));
    const article=articles.find(a=>key(a.articleCode)===key(code));
    if(!article) throw fail('Articolo non disponibile.',404);
    const lotType=article.articleType==='MateriaPrima'?'LottoMateriaPrima':article.articleType==='Semilavorato'?'LottoBulk':'LottoProdotto';
    const lots=[...new Map(allowedLots(archive,code,customerCodes).map(l=>[key(l.lotCode),{...l,lotType,quantity:null,unitOfMeasure:article.unitOfMeasure}])).values()];
    const genealogy=internal?archive.genealogy.filter(g=>key(g.codice_articolo_prodotto)===key(code)||key(g.codice_articolo_materia_prima)===key(code)).map(g=>({
      mesId:g.mes_id,productionOrderNumber:g.numero_ordine_produzione,octReference:g.riferimento_oct,rdpReference:g.riferimento_rdp,
      productArticleCode:g.codice_articolo_prodotto,destinationLot:g.lotto_destinazione,rawMaterialArticleCode:g.codice_articolo_materia_prima,
      rawMaterialDescription:g.descrizione_materia_prima,sourceLot:g.lotto_origine,quantity:g.quantita,unitOfMeasure:g.unita_misura,slDocument:g.documento_sl})):[];
    return {article,lots,documents:visibleDocuments(archive,code,customerCodes).map(documentDto),genealogy};
  }
  if(url.pathname==='/documents/reference') {
    const article=articles.find(a=>key(a.articleCode)===key(input.articleId));
    const file=archive.files.find(f=>f.active&&f.path===normalizePath(input.nasPath));
    if(!article||!file) throw fail('Articolo o file NAS non disponibile. Sincronizzare l’archivio.');
    const lotCode=value(input.lotCode);
    if(lotCode&&!allowedLots(archive,article.articleCode,customerCodes).some(l=>key(l.lotCode)===key(lotCode))) throw fail('Lotto non appartenente all’articolo.');
    const duplicate=archive.documents.find(d=>d.attivo&&key(d.percorso_nas)===key(file.path)&&key(d.codice_articolo)===key(article.articleCode)&&key(d.codice_lotto)===key(lotCode));
    if(duplicate) return documentDto(duplicate);
    const row=linkRow(file,{articleCode:article.articleCode,lotCode},input,profile.id);
    row.tipo_associazione=lotCode?(article.articleType==='MateriaPrima'?'LottoMateriaPrima':article.articleType==='Semilavorato'?'LottoBulk':'LottoProdotto'):'Articolo';
    await save(admin,'workspace_private_documents',[row],{onConflict:'external_id',ignoreDuplicates:true});
    return documentDto(row);
  }
  if(url.pathname.startsWith('/documents/')) {
    const id=url.pathname.slice('/documents/'.length);
    const document=archive.documents.find(d=>d.external_id===id);
    if(!document||!visibleDocuments(archive,document.codice_articolo,customerCodes).some(d=>d.external_id===id)) throw fail('Documento non disponibile.',404);
    const {error}=await admin.from('workspace_private_document_access_log').insert({user_id:profile.id,document_id:id});
    if(error) throw error;
    return {url:gatewayUrl('/files/'+normalizePath(document.percorso_nas).split('/').map(encodeURIComponent).join('/'))};
  }
  if(!internal) throw fail('Operazione riservata agli utenti interni.',403);
  if(url.pathname==='/unassociated') {
    const {data,error}=await admin.from('workspace_private_document_sync').select('*').eq('id',1).single();
    if(error) throw error;
    return {scannedAt:data.last_success,associated:0,warnings:data.warnings,unassociated:unassociated(archive)};
  }
  throw fail('Operazione documentale non disponibile.',404);
}

export function catalogue(archive,customerCodes) {
  const internal=customerCodes.includes('*');
  return archive.articles.flatMap(a=>{
    const lots=allowedLots(archive,a.articleCode,customerCodes);
    if(!internal&&!lots.length) return [];
    const documents=visibleDocuments(archive,a.articleCode,customerCodes);
    return [{...a,customers:internal?[...new Set(lots.map(l=>l.customerCode).filter(Boolean))]:customerCodes,
      lotCount:new Set(lots.map(l=>key(l.lotCode))).size,documentCount:documents.length,
      searchText:key([a.articleCode,a.description,a.articleType,...lots.map(l=>l.lotCode),
        ...documents.map(d=>`${d.titolo} ${d.nome_file_originale}`)].join(' '))}];
  });
}

const lotKey=(code,lot)=>JSON.stringify([key(code),key(lot)]);
const generalDocument=d=>!value(d.codice_lotto)&&d.tipo_associazione==='Articolo';
export function lotDocumentBundle(archive,code,lot,customerCodes) {
  if(!value(lot)||!allowedLots(archive,code,customerCodes).some(l=>key(l.lotCode)===key(lot)))
    throw fail('Lotto non disponibile.',404);
  const context={articleCode:code,lotCode:lot};
  const dto=d=>({...documentDto(d),downloadContext:context});
  const own=visibleDocuments(archive,code,customerCodes);
  const edges=new Map();
  for(const g of archive.genealogy) {
    const id=lotKey(g.codice_articolo_prodotto,g.lotto_destinazione);
    if(!edges.has(id)) edges.set(id,[]);
    edges.get(id).push(g);
  }
  const visited=new Set([lotKey(code,lot)]),queue=[{articleCode:code,lotCode:lot}],materials=[];
  for(let i=0;i<queue.length;i++) {
    const node=queue[i];
    for(const g of edges.get(lotKey(node.articleCode,node.lotCode))||[]) {
      if(!value(g.codice_articolo_materia_prima)||!value(g.lotto_origine)||Number(g.quantita)<=0) continue;
      const id=lotKey(g.codice_articolo_materia_prima,g.lotto_origine);
      if(visited.has(id)) continue;
      visited.add(id);
      const source={articleCode:g.codice_articolo_materia_prima,lotCode:g.lotto_origine,description:g.descrizione_materia_prima||''};
      queue.push(source);
      // Access is inherited only along the exact consumption chain of an authorized root lot.
      const documents=visibleDocuments(archive,source.articleCode,['*'])
        .filter(d=>generalDocument(d)||key(d.codice_lotto)===key(source.lotCode)).map(dto);
      materials.push({...source,documents});
    }
  }
  return {general:own.filter(generalDocument).map(dto),
    specific:own.filter(d=>value(d.codice_lotto)&&key(d.codice_lotto)===key(lot)).map(dto),materials};
}

export async function productionLotDocuments(admin,code,lot,customerCodes) {
  const archive=await readArchive(admin,code);
  // Validate the root before reading any upstream material data.
  const authorized=[...new Map(allowedLots(archive,code,customerCodes).map(l=>[key(l.lotCode),l.lotCode])).values()];
  if(lot!==null&&(!value(lot)||!authorized.some(l=>key(l)===key(lot)))) throw fail('Lotto non disponibile.',404);
  const visited=new Set(),allEdges=[],sourceCodes=new Set();
  let frontier=(lot===null?authorized:[lot]).map(lotCode=>({articleCode:code,lotCode}));
  while(frontier.length) {
    const next=[];
    for(let i=0;i<frontier.length;i+=40) {
      const batch=frontier.slice(i,i+40).filter(n=>!visited.has(lotKey(n.articleCode,n.lotCode)));
      if(!batch.length) continue;
      for(const n of batch) visited.add(lotKey(n.articleCode,n.lotCode));
      if(visited.size>2000) throw fail('Genealogia troppo estesa: impossibile completare la lettura dei documenti.',502);
      const expression=batch.map(n=>`and(codice_articolo_prodotto.eq.${JSON.stringify(n.articleCode)},lotto_destinazione.eq.${JSON.stringify(n.lotCode)})`).join(',');
      const edges=await rows(admin,'workspace_sl_genealogy','*',q=>q.or(expression));
      allEdges.push(...edges);
      for(const g of edges) {
        if(!value(g.codice_articolo_materia_prima)||!value(g.lotto_origine)||Number(g.quantita)<=0) continue;
        sourceCodes.add(g.codice_articolo_materia_prima);
        if(!visited.has(lotKey(g.codice_articolo_materia_prima,g.lotto_origine))) next.push({articleCode:g.codice_articolo_materia_prima,lotCode:g.lotto_origine});
      }
    }
    frontier=[...new Map(next.map(n=>[lotKey(n.articleCode,n.lotCode),n])).values()];
  }
  const codes=[...sourceCodes].filter(c=>key(c)!==key(code));
  for(let i=0;i<codes.length;i+=100) {
    const documents=await rows(admin,'workspace_private_documents','*',q=>q.in('codice_articolo',codes.slice(i,i+100)));
    for(const d of documents) {
      const k=key(d.codice_articolo);
      if(!archive.documentsByArticle.has(k)) archive.documentsByArticle.set(k,[]);
      archive.documentsByArticle.get(k).push(d);
    }
  }
  archive.genealogy=allEdges;
  if(lot===null) return {lots:authorized.map(lotCode=>({lotCode,...lotDocumentBundle(archive,code,lotCode,customerCodes)}))};
  return lotDocumentBundle(archive,code,lot,customerCodes);
}
