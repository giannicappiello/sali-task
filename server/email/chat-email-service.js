import {normalizeEmailRecipients} from './email-recipients.js';
const EMAIL_COLUMNS = 'id,source_kind,task_id,author_id,confirmed_by,recipient,to_recipients,cc_recipients,transport_protocol_version,subject,body,via_ai,status,idempotency_key,payload_hash,created_at,confirmed_at,claimed_at,accepted_at,provider_message_id,error_code,delegation_id,delegation_policy_hash,delegation_policy_version';
const DELEGATION_COLUMNS = 'id,author_id,policy_version,policy,policy_hash,status,created_at,approved_by,approved_at,revoked_by,revoked_at,approval_method';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUSINESS_ERRORS = new Set(['EMAIL_PERMISSION_REQUIRED','AI_EMAIL_PERMISSION_REQUIRED','EMAIL_NOT_ACCESSIBLE','EMAIL_CHANGED','EMAIL_PROPOSAL_EXPIRED','IDEMPOTENCY_CONFLICT','EMAIL_DELEGATION_REQUIRED','EMAIL_DELEGATION_CHANGED','FORBIDDEN']);
function assert(condition, message, status=400) { if(!condition) throw Object.assign(new Error(message),{status}); }
function uuid(value) { assert(typeof value==='string' && UUID.test(value),'Identificativo non valido.'); return value; }
function hash(value) { assert(typeof value==='string' && /^[a-f0-9]{64}$/.test(value),'Hash proposta non valido.'); return value; }
function checked(result) {
 if(result.error) {
  const code=String(result.error.message||'');
  const known=BUSINESS_ERRORS.has(code);
  throw Object.assign(new Error(known ? code : 'Operazione email non riuscita.'),{code:known?code:'EMAIL_OPERATION_FAILED',status: !known?500:code==='EMAIL_NOT_ACCESSIBLE'?404:/PERMISSION|FORBIDDEN|DELEGATION_REQUIRED/.test(code)?403:409});
 }
 return result.data;
}
function actor(auth) { return uuid(auth?.profile?.id); }
export function hashChatEmailDelegation(row) { return hash(row?.policy_hash); }
export async function getChatEmailCapability(auth) {
 return checked(await auth.scoped.rpc('workspace_chat_email_capability'));
}
export async function prepareChatEmail(auth,input) {
 assert(input && typeof input==='object' && !Array.isArray(input),'Proposta non valida.');
 assert(Object.keys(input).every(key=>['recipient','to','cc','subject','body','idempotencyKey'].includes(key)),'Campi email non supportati.');
 const {subject,body,idempotencyKey}=input;
 const recipients=normalizeEmailRecipients(input);
 assert(typeof subject==='string' && subject.trim().length>0 && subject.length<=200 && ![...subject].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127),'Oggetto non valido (massimo 200 caratteri).');
 assert(typeof body==='string' && body.trim().length>0 && body.length<=12000 && !body.includes(String.fromCharCode(0)),'Testo non valido (massimo 12000 caratteri).');
 assert(typeof idempotencyKey==='string' && /^[A-Za-z0-9:_-]{8,128}$/.test(idempotencyKey),'Chiave richiesta non valida.');
 return checked(await auth.scoped.rpc(recipients.protocol===2?'workspace_prepare_chat_email_v2':'workspace_prepare_chat_email',{...(recipients.protocol===2?{p_to:recipients.to,p_cc:recipients.cc}:{p_recipient:recipients.recipient}),p_subject:subject,p_body:body,p_idempotency_key:idempotencyKey}));
}
export async function sendChatEmail(auth,{id,expectedHash}) {
 // This function has no human-confirmation fallback. SQL requires an active,
 // unchanged personal delegation and current AI confirmation capabilities.
 return checked(await auth.scoped.rpc('workspace_send_chat_email',{p_id:uuid(id),p_expected_hash:hash(expectedHash)}));
}
export async function getChatEmail(auth,id) {
 const row=checked(await auth.scoped.from('workspace_emails').select(EMAIL_COLUMNS).eq('id',uuid(id)).eq('source_kind','chat').eq('author_id',actor(auth)).maybeSingle());
 assert(row,'Email non accessibile.',404); return row;
}
export async function listChatEmails(auth,{offset=0}={}) {
 assert(Number.isInteger(offset)&&offset>=0&&offset<=100000,'Pagina non valida.');
 const capability=await getChatEmailCapability(auth);
 assert(capability?.enabled===true,'EMAIL_PERMISSION_REQUIRED',403);
 const rows=checked(await auth.scoped.from('workspace_emails').select(EMAIL_COLUMNS).eq('source_kind','chat').eq('author_id',actor(auth))
  .order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+20))||[];
 return {emails:rows.slice(0,20),nextOffset:rows.length>20?offset+20:null};
}
export async function proposeChatEmailDelegation(auth,{policyVersion='chat-email-v1'}={}) {
 assert(['chat-email-v1','chat-email-v2'].includes(policyVersion),'Versione delega non valida.');
 return checked(await auth.scoped.rpc(policyVersion==='chat-email-v2'?'workspace_propose_email_delegation_v2':'workspace_propose_email_delegation'));
}
export async function getChatEmailDelegation(auth,id) {
 const row=checked(await auth.scoped.from('workspace_email_delegations').select(DELEGATION_COLUMNS).eq('id',uuid(id)).eq('author_id',actor(auth)).maybeSingle());
 assert(row,'Delega non accessibile.',404); return row;
}
// Only call these two functions from the human handler AFTER receipt validation.
// They are intentionally absent from the agent tool surface. The actor never
// comes from request input. Only service_role can call these SQL RPCs.
export async function decideChatEmailDelegation(auth,{id,confirm,expectedHash}) {
 assert(typeof confirm==='boolean','Decisione esplicita richiesta.');
 return checked(await auth.admin.rpc('workspace_decide_email_delegation',{p_actor:actor(auth),p_id:uuid(id),p_confirm:confirm,p_expected_hash:hash(expectedHash)}));
}
export async function decideChatEmailHuman(auth,{id,confirm,expectedHash}) {
 assert(typeof confirm==='boolean','Decisione esplicita richiesta.');
 return checked(await auth.admin.rpc('workspace_decide_chat_email_human',{p_actor:actor(auth),p_id:uuid(id),p_confirm:confirm,p_expected_hash:hash(expectedHash)}));
}
