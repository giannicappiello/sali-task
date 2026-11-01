import { readFile } from 'node:fs/promises';
import { createClient } from './src/client.mjs';
import { createVault } from './src/vault.mjs';
import { startInteraction } from './src/interactive.mjs';

try {
  const config=JSON.parse((await readFile(new URL('./config.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
  const client=createClient(config,createVault());
  const interaction=await startInteraction({type:'login',client,ttlMs:900000});
  process.stdout.write(`Apri questo collegamento nel browser di questo PC e accedi a Workspace:\n${interaction.url}\n`);
  const timer=setInterval(()=>{
    const result=interaction.getStatus();
    if(result.status==='completed'){
      process.stdout.write(`Workspace collegato: ${result.outcome.identity.name}\n`);
      clearInterval(timer);interaction.close();
    }else if(result.status==='expired'){
      process.stderr.write('Collegamento scaduto. Eseguire nuovamente Connect-Workspace.mjs.\n');
      clearInterval(timer);interaction.close();process.exitCode=2;
    }
  },1000);
}catch{
  process.stderr.write('Configurazione non disponibile. Eseguire prima Install-SecondBrain.ps1. Non inviare credenziali nella chat.\n');
  process.exitCode=1;
}
