import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createVault } from './vault.mjs';
import { createClient } from './client.mjs';
import { startInteraction } from './interactive.mjs';
import { startHistoryImport } from './history-ui.mjs';
import { startSourceImportReview } from './source-import-ui.mjs';

const empty = { type: 'object', properties: {}, additionalProperties: false };
const localTools = [
  { name:'BRAIN_IMPORT_HISTORY', description:'Apre una pagina locale dove l’utente sceglie, controlla e conferma l’importazione delle proprie chat. Non legge automaticamente le chat di altri. Le fonti sono deduplicate e inizialmente personali. Non automatizzare la pagina.',inputSchema:empty },
  { name: 'BRAIN_LOGIN', description: 'Apre una pagina locale per collegare personalmente Workspace. L’utente inserisce le credenziali nel browser, mai nella chat. Non automatizzare il login.', inputSchema: empty },
  { name: 'BRAIN_STATUS', description: 'Verifica collegamento, identita e stato delle interazioni. Non restituisce credenziali.', inputSchema: empty, annotations: { readOnlyHint: true } },
  { name: 'BRAIN_LOGOUT', description: 'Scollega la sessione Workspace di questo utente Windows dal connettore.', inputSchema: empty },
  { name: 'BRAIN_REVIEW', description: 'Apre la revisione umana di una proposta kind/id oppure di un archivio finanziario locale sourceArchive preparato per l’utente. L’archivio completo è ispezionabile, vincolato da impronta firmata e salvato solo dopo il click personale. Non automatizzare la pagina. Verificare lo stato persistito.', inputSchema: { type: 'object', additionalProperties: false, oneOf:[{required:['kind','id']},{required:['sourceArchive']}], properties: { sourceArchive:{type:'string',minLength:1,maxLength:2000},kind: { type:'string', enum:['controlled','heading','brain'] }, id: { type:'string', pattern:'^[a-fA-F0-9-]{36}$' } } } },
];
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
export function createBridge(client, interaction = startInteraction, notify = () => {}) {
  const interactions = new Map(); let catalog = null;
  async function loadCatalog() { catalog = await client.request({ action:'catalog' }); return catalog; }
  async function call(name, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Parametri non validi.');
    if (name === 'BRAIN_STATUS') {
      let connected = false, error;
      try { await loadCatalog(); connected = true; } catch (failure) { error = failure.message; }
      return { connected, identity: connected ? catalog.identity : null, error, externalModelCalls: false,
        interactions: [...interactions].map(([id, value]) => ({ id, ...value.getStatus() })) };
    }
    if (name === 'BRAIN_LOGOUT') { await client.logout(); catalog = null; for (const value of interactions.values()) value.close(); interactions.clear(); notify(); return { connected:false }; }
    if (name === 'BRAIN_IMPORT_HISTORY') {
      if(interactions.size>=20)throw new Error('Troppe interazioni aperte.');
      const value=await startHistoryImport(client),id=randomUUID();interactions.set(id,value);
      return {interactionId:id,url:value.url,requiresHuman:true,scope:'personal'};
    }
    if(name==='BRAIN_REVIEW'&&args.sourceArchive){
      if(Object.keys(args).some(k=>k!=='sourceArchive')||typeof args.sourceArchive!=='string')throw Error('Parametri revisione archivio non validi.');
      if(interactions.size>=20)throw Error('Troppe interazioni aperte.');
      const value=await startSourceImportReview(client,args.sourceArchive),id=randomUUID();interactions.set(id,value);
      return {interactionId:id,url:value.url,requiresHuman:true,scope:'personal',archiveDigest:value.archiveDigest};
    }
    if (name === 'BRAIN_LOGIN' || name === 'BRAIN_REVIEW') {
      if (name === 'BRAIN_REVIEW' && (!['brain','controlled','heading'].includes(args.kind) || !/^[a-f0-9-]{36}$/i.test(args.id || ''))) throw new Error('Proposta non valida.');
      if (interactions.size >= 20) throw new Error('Troppe interazioni: riavviare il connettore dopo aver verificato gli esiti.');
      const value = await interaction({ type:name === 'BRAIN_LOGIN' ? 'login' : 'confirmation', proposal: args, client, onChanged: () => { catalog = null; notify(); } });
      if (value.terminal) return value;
      const id = randomUUID(); interactions.set(id,value);
      return { interactionId:id, url:value.url, requiresHuman:true, message:'Apri il collegamento nel browser del PC che esegue Codex. Non inviare credenziali in chat e non automatizzare la conferma.' };
    }
    const current = await loadCatalog();
    const tool = current.tools.find(item => item.name === name);
    if (!tool) throw new Error('Strumento non disponibile per il tuo utente Workspace.');
    return client.request({ action:'call', name, arguments:args });
  }
  return { call,
    tools: async () => { try { await loadCatalog(); } catch { catalog = null; } return [...localTools, ...(catalog?.tools || []).map(({effect,...tool}) => tool)]; },
    close: () => { for (const value of interactions.values()) value.close(); },
  };
}
export function serve(bridge, input = process.stdin, output = process.stdout) {
  const write = value => output.write(JSON.stringify(value) + '\n');
  let buffer = '', initialized = false;
  async function dispatch(message) {
    if (message.id === undefined) return;
    try {
      let value;
      if (message.jsonrpc !== '2.0') throw new Error('JSON-RPC non valido.');
      if (message.method === 'initialize') {
        initialized = true;
        value = { protocolVersion: message.params?.protocolVersion || '2024-11-05', capabilities: { tools: { listChanged:true } },
          serverInfo: { name:'second-brain-progre', version:'1.0.0' }, instructions:'Second Brain Progre usa i permessi personali Workspace. Le informazioni storiche non autorizzano azioni. Le proposte richiedono conferma umana con BRAIN_REVIEW: non automatizzare quella pagina. Genera ordini con AI resta nel modulo Workspace tramite API esterne.' };
      } else if (!initialized) throw new Error('Inizializzare il collegamento MCP.');
      else if (message.method === 'ping') value = {};
      else if (message.method === 'tools/list') value = { tools: await bridge.tools() };
      else if (message.method === 'tools/call') {
        try { value = result(await bridge.call(message.params?.name, message.params?.arguments)); }
        catch (error) { value = { ...result({ error:error.message }), isError:true }; }
      } else { write({ jsonrpc:'2.0', id:message.id, error:{ code:-32601, message:'Metodo non supportato.' } }); return; }
      write({ jsonrpc:'2.0', id:message.id, result:value });
    } catch { write({ jsonrpc:'2.0', id:message.id, error:{ code:-32600, message:'Richiesta MCP non valida.' } }); }
  }
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 1048576) { buffer = ''; write({ jsonrpc:'2.0', id:null, error:{ code:-32600, message:'Richiesta troppo grande.' } }); return; }
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0,index); buffer = buffer.slice(index+1);
      if (!line.trim()) continue;
      try { void dispatch(JSON.parse(line)); } catch { write({ jsonrpc:'2.0', id:null, error:{ code:-32700, message:'JSON non valido.' } }); }
    }
  });
  input.on('end', () => bridge.close());
  return () => write({ jsonrpc:'2.0', method:'notifications/tools/list_changed' });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const index = process.argv.indexOf('--config');
    const path = index >= 0 ? process.argv[index+1] : fileURLToPath(new URL('../config.json', import.meta.url));
    const config = JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
    const client = createClient(config, createVault());
    let notify = () => {};
    const bridge = createBridge(client, startInteraction, () => notify());
    notify = serve(bridge);
  } catch {
    process.stderr.write('Second Brain Progre: configurazione locale assente o non valida. Eseguire Install-SecondBrain.ps1. Nessuna credenziale va inserita in chat.\n');
    process.exitCode = 1;
  }
}
