import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {randomBytes} from 'node:crypto';
import {importTree,importHash} from './source-import-proof.mjs';
import {page} from './interactive.mjs';
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function startSourceImportReview(client,path,ttlMs=3600000){
 if(!isAbsolute(path)||(await stat(path)).size>250000000)throw Error('Archivio locale non valido o oltre 250 MB.');
 const archive=JSON.parse(await readFile(path,'utf8'));
 const owner=(await client.request({action:'catalog'})).identity.id;
 if(archive.format!=='second-brain-source-import-v1'||archive.ownerId!==owner||!Array.isArray(archive.entries))throw Error('Archivio di un altro utente o formato non valido.');
 for(const e of archive.entries)if(e.scope!=='personal'||e.kind!=='historical'||e.source!=='second-brain:MEXAL_FINANCE_READ')throw Error('Archivio non personale o fonte non ammessa.');
 const tree=importTree(archive.entries),identity=owner;
 // A signed commitment binds every later batch to the exact content reviewed.
 // The receipt stays inside this local UI and is never returned to the model.
 const manifest={root:tree.root,entries:archive.entries.length};
 let confirmation=await client.request({action:'source_import_confirmation',manifest}),receiptIssuedAt=Date.now();
 if(confirmation.identity.id!==identity)throw Error('Identità cambiata.');
 const secret=randomBytes(32).toString('hex'),nonce=randomBytes(16).toString('hex');
 let status='waiting',imported=0,error=null,closed=false;
 async function run(){
  try{
   for(let i=0;i<archive.entries.length;i+=4){
    if(closed){status='cancelled';return;}
    // Long imports may outlive a receipt. Renew only the identical reviewed
    // commitment, while this human-started operation is still running.
    if(Date.now()-receiptIssuedAt>3000000){
     const renewed=await client.request({action:'source_import_confirmation',manifest});
     if(renewed.identity.id!==identity)throw Error('Identità cambiata.');
     confirmation=renewed;receiptIssuedAt=Date.now();
    }
    const entries=archive.entries.slice(i,i+4),proofs=entries.map((_,j)=>tree.proof(i+j));
    const result=await client.request({action:'source_import_batch',receipt:confirmation.receipt,entries,proofs});
    if(result.imported!==entries.length)throw Error('Conteggio persistito inatteso.');
    imported+=result.imported;
   }
   status='completed';
  }catch{status='uncertain';error='Importazione interrotta: verificare lo stato persistito. Il contenuto ha chiavi deduplicate; non creare un archivio diverso per riprovare.';}
 }
 const server=createServer(async(req,res)=>{
  const origin=`http://127.0.0.1:${server.address().port}`,url=new URL(req.url,origin);
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',`default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
  if(req.headers.host!==`127.0.0.1:${server.address().port}`||url.pathname!==`/${secret}`){res.writeHead(404);res.end();return;}
  if(req.method==='GET'&&url.searchParams.has('status')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status,imported,total:archive.entries.length,root:tree.root,error}));return;}
  if(req.method==='GET'&&url.searchParams.has('archive')){res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="Mexal-GRE-2026-da-importare.json"');res.end(JSON.stringify(archive,null,2));return;}
  if(req.method==='GET'){
   res.setHeader('Content-Type','text/html; charset=utf-8');
   const content=`<p>Utente: <strong>${escape(confirmation.identity.name)}</strong>. Copia storica nella memoria personale; Mexal rimane la fonte dei dati correnti.</p><pre>${escape(JSON.stringify(archive.summary,null,2))}</pre><p>Frammenti: ${archive.entries.length}. Impronta archivio: ${tree.root}</p><p><a href="?archive=1">Scarica e controlla tutto il contenuto da memorizzare</a></p><p>Importi, codici e riferimenti rimangono quelli della fonte. Nessun ricalcolo. Nessuna modifica a Mexal, permessi o condivisione aziendale.</p>${status==='waiting'?'<form method="post"><button name="decision" value="confirm">Confermo l’importazione dell’archivio nella mia memoria personale</button><button name="decision" value="reject">Rifiuta</button></form>':''}<p id="state"></p><script nonce="${nonce}">setInterval(async()=>{const d=await(await fetch(location.pathname+'?status=1')).json();document.getElementById('state').textContent=d.status+' — '+d.imported+'/'+d.total+(d.error?' — '+d.error:'');},2000)</script>`;
   res.end(page('BRAIN_REVIEW — Importazione Mexal GRE 2026',content,nonce));return;
  }
  if(req.method!=='POST'||req.headers.origin!==origin||status!=='waiting'||!String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')){res.writeHead(403);res.end();return;}
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1000){res.writeHead(413);res.end();return;}}
  const decision=new URLSearchParams(raw).get('decision');
  if(!['confirm','reject'].includes(decision)){res.writeHead(400);res.end();return;}
  status=decision==='confirm'?'running':'rejected';
  res.writeHead(303,{Location:`/${secret}`});res.end();
  if(status==='running')void run();
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const timer=setTimeout(()=>{if(status==='waiting'){status='expired';server.close();}},ttlMs);timer.unref();
 return {url:`http://127.0.0.1:${server.address().port}/${secret}`,getStatus:()=>({type:'source-import',status,imported,total:archive.entries.length,root:tree.root,error}),close:()=>{closed=true;clearTimeout(timer);server.close();},archiveDigest:importHash(archive)};
}
