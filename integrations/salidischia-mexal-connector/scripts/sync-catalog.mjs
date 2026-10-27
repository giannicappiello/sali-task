import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {wooClient,mexalTransport} from '../src/clients.mjs';
import {runCatalog} from '../src/catalog.mjs';
import {backupCatalogProduct} from '../src/catalog-backup.mjs';
import {acquireRunLock} from '../src/run-lock.mjs';
const dryRun=!process.argv.includes('--write');
const onlyArg=process.argv.find(arg=>arg.startsWith('--only='));
const onlyIds=onlyArg?onlyArg.slice(7).split(',').map(Number):null;
let release;
try{
 if(!dryRun)release=await acquireRunLock();
 const config=JSON.parse(await readFile('.private/connector-config.json','utf8'));
 const report=await runCatalog({woo:wooClient(process.env,undefined,{enableWrites:!dryRun}),mexal:mexalTransport(),dryRun,onlyIds,aliases:config.catalogSkuAliases||{},excludedIds:config.catalogExcludedIds||[],beforeWrite:backupCatalogProduct,onResult:row=>{if(!dryRun)console.log(JSON.stringify(row));}});
 await mkdir('output',{recursive:true});await writeFile(`output/catalog-${dryRun?'preview':'last-run'}.json`,JSON.stringify({at:new Date().toISOString(),...report},null,2));
 console.log(JSON.stringify({dryRun,products:report.products,counts:report.results.reduce((r,x)=>(r[x.mode]=(r[x.mode]||0)+1,r),{})}));
 if(report.results.some(x=>x.mode==='attention-required'))process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}finally{await release?.();}
