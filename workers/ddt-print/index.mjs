import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const endpoint=process.env.DDT_WORKSPACE_URL,secret=process.env.DDT_PRINT_WORKER_SECRET,station=process.env.DDT_PRINT_STATION,renderer=process.env.SUMATRA_PDF_PATH;
if (!/^https:\/\//.test(endpoint || '') || !secret || !/^[A-Za-z0-9_-]{1,80}$/.test(station || '') || !renderer || process.platform!=='win32') throw Error('Configurare DDT_WORKSPACE_URL (HTTPS), DDT_PRINT_WORKER_SECRET, DDT_PRINT_STATION e SUMATRA_PDF_PATH su Windows.');
await access(renderer);
async function api(action,input={}) {
  const response=await fetch(new URL('/api/mexal/automation?route=order-preparation',endpoint),{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({operation:'print_worker',station,action,input}),signal:AbortSignal.timeout(45000)});
  const data=await response.json();if(!response.ok)throw Error(data.error || 'Agente stampa non disponibile');return data.result;
}
function execute(file,args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:240000});let output='';
    child.stdout.on('data',chunk=>output+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(Error('Processo stampa terminato con codice '+code)));
  });
}
async function inventory() {
  const names=JSON.parse((await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command','ConvertTo-Json -Compress -InputObject @(Get-Printer | Select-Object -ExpandProperty Name)'])).trim());
  await api('inventory',{printers:names});
}
let lastInventory=0;
do {
  try {
    if(Date.now()-lastInventory>60000){await inventory();lastInventory=Date.now();}
    const job=await api('claim');
    if(job){
      let folder,started=false;
      try {
        const bytes=Buffer.from(job.document.base64,'base64');
        if(bytes.subarray(0,5).toString()!=='%PDF-' || createHash('sha256').update(bytes).digest('hex')!==job.document.sha256)throw Error('PDF non verificato');
        folder=await mkdtemp(join(tmpdir(),'progre-ddt-'));const path=join(folder,job.id+'.pdf');await writeFile(path,bytes);
        await api('printing',{id:job.id,token:job.token});started=true;
        await execute(renderer,['-silent','-print-to',job.printerName,'-print-settings','1x',path]);
        await api('submitted',{id:job.id,token:job.token});
      } catch(error) {
        await api(started?'uncertain':'failed',{id:job.id,token:job.token,error:error.message});
      } finally {
        if(folder){const inside=relative(resolve(tmpdir()),resolve(folder));if(inside.startsWith('progre-ddt-') && !inside.includes('..') && !isAbsolute(inside))await rm(folder,{recursive:true,force:true});}
      }
    } else if(!process.argv.includes('--once')) await delay(5000);
  } catch(error){process.stderr.write(error.message+'\n');if(!process.argv.includes('--once'))await delay(10000);}
} while(!process.argv.includes('--once'));
