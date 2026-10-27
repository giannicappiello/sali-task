import{readFile,mkdir,writeFile}from'node:fs/promises';
import{wooClient,mexalTransport}from'../src/clients.mjs';
import{MexalAdapter}from'../src/adapter.mjs';
import{Journal}from'../src/journal.mjs';
import{runBatch}from'../src/worker.mjs';
import{runCatalog}from'../src/catalog.mjs';
import{backupCatalogProduct}from'../src/catalog-backup.mjs';
import{acquireRunLock}from'../src/run-lock.mjs';
const dryRun=!process.argv.includes('--write');
let journal,release;
try{
 if(!dryRun)release=await acquireRunLock();
 const config=JSON.parse(await readFile('.private/connector-config.json','utf8'));
 try{const previous=JSON.parse(await readFile('output/catalog-last-run.json','utf8'));if(!previous.dryRun&&!previous.results.some(x=>x.mode==='attention-required'))config.catalogLastSuccessAt=previous.at;}catch{}
 if(!dryRun&&!config.cutoverVerified)throw new Error('Attivazione bloccata: il vecchio connettore deve essere fermato e il passaggio verificato.');
 const woo=wooClient(process.env,undefined,{enableWrites:!dryRun});
 if(!dryRun){
  const status=await woo.connectorStatus();
  if(status.partition_active!==true||status.last_legacy_order_id!==config.legacyReconciledThrough||status.authenticated_key_id!==status.connector_key_id)throw new Error('Separazione dal vecchio connettore non verificata sul sito: invio bloccato.');
 }
 const mexal=new MexalAdapter(mexalTransport(process.env,undefined,{enableWrites:!dryRun}),config);
 journal=new Journal('data/connector.sqlite');
 const summary=await runBatch({woo,mexal,journal,config,dryRun,onResult:row=>console.log(JSON.stringify(row))});
 await mkdir('output',{recursive:true});await writeFile('output/last-run.json',JSON.stringify({at:new Date().toISOString(),...summary},null,2));
 console.log(JSON.stringify({dryRun,processed:summary.processed,attention:summary.results.filter(x=>x.mode==='attention-required').length}));
 if(summary.results.some(x=>x.mode==='attention-required'))process.exitCode=1;
 // An individual order requiring reconciliation must not freeze stock/prices.
 if(config.catalogEnabled){
  const catalog=await runCatalog({woo,mexal:mexalTransport(),dryRun,aliases:config.catalogSkuAliases||{},excludedIds:config.catalogExcludedIds||[],beforeWrite:backupCatalogProduct});
  await writeFile('output/catalog-last-run.json',JSON.stringify({at:new Date().toISOString(),...catalog},null,2));
  console.log(JSON.stringify({catalog:true,dryRun,products:catalog.products,counts:catalog.results.reduce((r,x)=>(r[x.mode]=(r[x.mode]||0)+1,r),{})}));
  if(catalog.results.some(x=>x.mode==='attention-required'))process.exitCode=1;
 }
 if(summary.results.some(x=>x.crmReference==='pending'||x.crmStatus==='pending'))process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}finally{journal?.close();await release?.();}
