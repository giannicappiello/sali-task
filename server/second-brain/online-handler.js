import {authorizeAIRequest} from '../ai/access.js';
import {handleSecondBrain} from './handler.js';
import {ORIGIN,RESOURCE,ISSUER,fail,adminClient,check,authorizationInput,grantConnection,exchangeToken,remoteSession} from './online-auth.js';

const empty={type:'object',properties:{},additionalProperties:false};
const reviewSchema={type:'object',additionalProperties:false,required:['kind','id'],properties:{kind:{type:'string',enum:['brain','controlled','heading']},id:{type:'string',format:'uuid'}}};
const localTools=[{name:'BRAIN_STATUS',description:'Verifica identita Workspace e collegamento online. Non restituisce credenziali.',inputSchema:empty,annotations:{readOnlyHint:true}},{name:'BRAIN_REVIEW',description:'Restituisce il collegamento al riepilogo in Workspace, dove la persona verifica e conferma. Non automatizzare quella pagina. Nessuna modifica viene applicata da questo strumento.',inputSchema:reviewSchema,annotations:{readOnlyHint:true}}];
const content=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const bearer=req=>String(req.headers.authorization||'').replace(/^Bearer /,'');
const body=req=>typeof req.body==='string'?Object.fromEntries(new URLSearchParams(req.body)):req.body||{};
export const onlineStatus=catalog=>({connected:true,online:true,identity:catalog.identity,productionPermissions:catalog.productionPermissions||[],externalModelCalls:false,financialTools:catalog.tools.filter(t=>/^MEXAL_(?:FINANCE|ARCHIVE|CASHFLOW|BANK_BALANCES)_/.test(t.name)).map(t=>t.name),toolDiscovery:'Se financialTools elenca strumenti non disponibili nella chat, aggiornare le azioni della connessione esistente nelle impostazioni del plugin; non cambiare i permessi Workspace.'});

export async function handleOnline(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Content-Type-Options','nosniff');
 const operation=req.query.operation;
 try{
  if(operation==='resource-metadata'&&req.method==='GET')return res.json({resource:RESOURCE,authorization_servers:[ISSUER],scopes_supported:['second_brain','offline_access'],bearer_methods_supported:['header'],resource_name:'Second Brain Progre'});
  if(operation==='authorization-metadata'&&req.method==='GET')return res.json({issuer:ISSUER,authorization_endpoint:ORIGIN+'/api/second-brain/oauth/authorize',token_endpoint:ORIGIN+'/api/second-brain/oauth/token',revocation_endpoint:ORIGIN+'/api/second-brain/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:['second_brain','offline_access'],authorization_response_iss_parameter_supported:true,client_id_metadata_document_supported:true});
  if(operation==='authorize'&&req.method==='GET'){
   const verified=await authorizationInput(req.query);const target=new URL('/assistente-ai',ORIGIN);target.search=new URLSearchParams({view:'connect',...verified}).toString();return res.redirect(302,target.href);
  }
  if(operation==='token'&&req.method==='POST'){
   if(JSON.stringify(req.body||'').length>15000)throw fail('invalid_request');
   return res.json(await exchangeToken(body(req)));
  }
  if(operation==='revoke'&&req.method==='POST'){
   const input=body(req);const admin=adminClient();
   const {hash}=await import('./online-auth.js');
   const row=check(await admin.from('second_brain_oauth_tokens').select('connection_id').eq('hash',hash(input.token||'')).maybeSingle());
   if(row){const connection=check(await admin.from('second_brain_connections').select('client_id').eq('id',row.connection_id).maybeSingle());if(connection?.client_id===input.client_id)check(await admin.from('second_brain_connections').update({revoked_at:new Date().toISOString(),session_sealed:''}).eq('id',row.connection_id));}
   return res.status(200).json({});
  }
  if(operation==='connection'&&req.method==='POST'){
   if(req.headers.origin!==ORIGIN||JSON.stringify(req.body||{}).length>20000)throw fail('Origine non autorizzata.',403);
   const auth=await authorizeAIRequest(req);if(!auth.capabilities.internal_data)throw fail('Second Brain non abilitato.',403);
   const input=body(req);
   if(input.action==='list')return res.json({success:true,connections:check(await auth.admin.from('second_brain_connections').select('id,client_id,created_at,expires_at,revoked_at').eq('user_id',auth.profile.id).is('revoked_at',null))});
   if(input.action==='revoke'){
    if(!/^[a-f0-9-]{36}$/i.test(input.id||''))throw fail('Collegamento non valido.');
    check(await auth.admin.from('second_brain_connections').update({revoked_at:new Date().toISOString(),session_sealed:''}).eq('id',input.id).eq('user_id',auth.profile.id));return res.json({success:true});
   }
   const verified=await authorizationInput(input.authorization||{});
   const identity={id:auth.profile.id,name:[auth.profile.nome,auth.profile.cognome].filter(Boolean).join(' ')};
   if(input.action==='preview')return res.json({success:true,identity,clientName:'ChatGPT / Codex OpenAI',authorization:verified});
   if(input.action!=='grant'||input.expectedUserId!==auth.profile.id)throw fail('Identita cambiata. Riaprire il collegamento.',403);
   const redirect=await grantConnection(auth,verified,input.refreshToken);return res.json({success:true,redirect});
  }
  if(operation!=='mcp')throw fail('Metodo non consentito.',405);
  const origin=req.headers.origin;
  if(origin&&![ORIGIN,'https://chatgpt.com'].includes(origin))throw fail('Origine non autorizzata.',403);
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST, GET, DELETE, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id');return res.status(204).end();}
  const remote=await remoteSession(bearer(req));
  const forwarded={method:'POST',headers:{authorization:'Bearer '+remote.token},body:{action:'catalog'}};
  const catalog=await handleSecondBrain(forwarded);
  if(catalog.identity.id!==remote.userId)throw fail('Identita del collegamento cambiata.',401);
  if(req.method==='DELETE')return res.status(204).end();
  if(req.method!=='POST'){res.setHeader('Allow','POST, DELETE');throw fail('Flusso SSE non necessario: usare POST.',405);}
  const input=body(req);if(Array.isArray(input)||JSON.stringify(input).length>100000||input.jsonrpc!=='2.0')throw fail('Richiesta MCP non valida.');
  if(input.id===undefined){if(input.method==='notifications/initialized'||input.method==='notifications/cancelled')return res.status(202).end();throw fail('Notifica non supportata.');}
  let result;
  if(input.method==='initialize')result={protocolVersion:['2025-03-26','2025-06-18','2025-11-25'].includes(input.params?.protocolVersion)?input.params.protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'second-brain-progre',version:'2.0.0'},instructions:catalog.instructions};
  else if(input.method==='ping')result={};
  else if(input.method==='tools/list')result={tools:[...localTools,...catalog.tools.map(({name,description,inputSchema,annotations})=>({name,description,inputSchema,annotations}))]};
  else if(input.method==='tools/call'){
   const name=input.params?.name,args=input.params?.arguments||{};
   try{
    if(name==='BRAIN_STATUS')result=content(onlineStatus(catalog));
    else if(name==='BRAIN_REVIEW'){
     if(!['brain','controlled','heading'].includes(args.kind)||!/^[a-f0-9-]{36}$/i.test(args.id||''))throw fail('Proposta non valida.');
     result=content({requiresHuman:true,url:ORIGIN+'/assistente-ai?'+new URLSearchParams({view:'review',kind:args.kind,proposalId:args.id}),message:'Apri Workspace e conferma personalmente il riepilogo. Non automatizzare la conferma.'});
    }else result=content(await handleSecondBrain({...forwarded,body:{action:'call',name,arguments:args}}));
   }catch(error){result={isError:true,content:[{type:'text',text:Number(error.status)<500?error.message:'Operazione non conclusa. Verifica lo stato prima di ripetere.'}]};}
  }else return res.json({jsonrpc:'2.0',id:input.id,error:{code:-32601,message:'Metodo non supportato.'}});
  return res.json({jsonrpc:'2.0',id:input.id,result});
 }catch(error){
  const status=Number(error.status)||500;
  if(status===401)res.setHeader('WWW-Authenticate',`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", error="invalid_token"`);
  return res.status(status).json({error:operation==='token'?(status<500?error.message:'server_error'):(status<500?error.message:'Second Brain online non disponibile.')});
 }
}
