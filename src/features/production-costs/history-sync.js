const check=signal=>signal?.throwIfAborted();

export async function recoverCostDocuments({jobs,request,refresh,onProgress=()=>{},signal}) {
 let next=0,completed=0,failures=0,warnings=0,slRecovered=0,ocRecovered=0;
 const worker=async()=>{
  while(next<jobs.length){
   check(signal);const job=jobs[next++];
   for(const [needed,operation] of [[job.oct,"sync-oct"],[job.sl,"sync-product-sl"]]){
    if(!needed)continue;check(signal);
    try{
     const result=await request(operation,{id:job.id},{signal,timeoutMs:90000});
     warnings+=result.warnings?.length||0;
     if(job.sl&&operation==="sync-product-sl")slRecovered+=result.recovered||0;
     if(operation==="sync-oct")ocRecovered+=result.recovered||0;
    }catch{check(signal);failures++;}
   }
   completed++;onProgress(`Storico MES disponibile. Recupero documenti: ${completed}/${jobs.length}${failures?` · ${failures} recuperi non riusciti`:""}.`);
  }
 };
 // Different orders may run together; OC and SL for the same order stay serial
 // so independent evidence updates cannot overwrite one another.
 await Promise.all(Array.from({length:Math.min(2,jobs.length)},worker));
 check(signal);if(jobs.length)await refresh();
 return {failures,warnings,slRecovered,ocRecovered};
}

export async function syncCostHistory({request,refresh,onProgress=()=>{},signal,recoverDocuments=true}) {
 let page=1,result,imported=0;const jobs=new Map();
 do{
  check(signal);onProgress(`Importazione storico MES · pagina ${page}…`);
  result=await request("sync",{page},{signal,timeoutMs:90000});
  imported+=result.imported||0;
  for(const [key,ids] of [["oct",result.octRecoveryIds],["sl",result.recoveryIds]])for(const id of ids||[]){
   const job=jobs.get(id)||{id};job[key]=true;jobs.set(id,job);
  }
  onProgress(`Importati ${imported}/${result.total} ordini MES.`);page++;
 }while(result.hasMore);
 // Publish all MES pages before slow optional Mexal document lookups begin.
 check(signal);onProgress(`Importazione MES completata: ${imported} ordini. Aggiornamento elenco…`);
 await refresh();check(signal);
 if(!recoverDocuments)return {imported,failures:0,warnings:0,slRecovered:0,ocRecovered:0};
 if(jobs.size)onProgress(`Elenco MES aggiornato: ${imported} ordini. Recupero documenti: 0/${jobs.size}.`);
 const documents=await recoverCostDocuments({jobs:[...jobs.values()],request,refresh,onProgress,signal});
 return {imported,...documents};
}

// The MES frame already emits workspace:production-changed after a closure.
// Polling covers closures performed on another station or in another browser.
export function watchCostHistory({run,onError=()=>{},isBusy=()=>false,browser=window,page=document,timers=globalThis}) {
 let disposed=false,running=false,pending=false,controller;
 async function refresh(force=false){
  if(disposed||page.hidden)return;
  if(running||isBusy()){pending ||= force;return;}
  running=true;pending=false;controller=new AbortController();
  try{await run(controller.signal);}catch(error){if(!disposed&&!controller.signal.aborted)onError(error);}
  finally{running=false;if(pending&&!disposed&&!isBusy())void refresh(true);}
 }
 const changed=()=>{void refresh(true);},normal=()=>{void refresh();};
 const interval=timers.setInterval(normal,60000);
 browser.addEventListener("workspace:production-changed",changed);
 browser.addEventListener("focus",normal);page.addEventListener("visibilitychange",normal);
 Promise.resolve().then(normal);
 return {idle:()=>{if(pending)changed();},dispose:()=>{
  disposed=true;controller?.abort();timers.clearInterval(interval);
  browser.removeEventListener("workspace:production-changed",changed);
  browser.removeEventListener("focus",normal);page.removeEventListener("visibilitychange",normal);
 }};
}
