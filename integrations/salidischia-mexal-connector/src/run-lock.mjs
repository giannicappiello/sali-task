import {mkdir,open,readFile,unlink} from 'node:fs/promises';

// Shared by the scheduled worker and manual catalog runs. Remove stale locks
// only after the owner process has ended; time alone cannot prove that.
export async function acquireRunLock(path='.private/connector-run.lock'){
 await mkdir('.private',{recursive:true});
 for(let attempt=0;attempt<2;attempt++){
  try{
   const handle=await open(path,'wx');
   await handle.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));await handle.close();
   return async()=>{const owner=JSON.parse(await readFile(path,'utf8'));if(owner.pid===process.pid)await unlink(path);};
  }catch(error){
   if(error.code!=='EEXIST')throw error;
   let owner;try{owner=JSON.parse(await readFile(path,'utf8'));}catch{throw Error('Un altro ciclo del connettore è in avvio.');}
   if(!Number.isSafeInteger(owner.pid)||owner.pid<1)throw Error('Blocco connettore da verificare.');
   try{process.kill(owner.pid,0);}catch(probe){if(probe.code==='ESRCH'){await unlink(path);continue;}throw Error('Impossibile verificare il processo del connettore.');}
   throw Error('Un altro ciclo del connettore è già in esecuzione.');
  }
 }
 throw Error('Impossibile acquisire il blocco del connettore.');
}
