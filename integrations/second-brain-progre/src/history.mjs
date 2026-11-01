import { createHash } from 'node:crypto';

export function redactHistory(value) {
  return String(value || '')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[CHIAVE PRIVATA RIMOSSA]')
    .replace(/<Objs\b[\s\S]*?<\/Objs>/gi,'[CREDENZIALI WINDOWS RIMOSSE]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]{20,})\b/g,'[SEGRETO RIMOSSO]')
    .replace(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[TOKEN RIMOSSO]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi,'$1[SEGRETO RIMOSSO]')
    .replace(/((?:password|passwd|pwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|connection[_ -]?string|SUPABASE_SERVICE_ROLE_KEY|PROGREMES_INTEGRATION_SECRET)\s*["']?\s*[:=]\s*)[^\r\n]+/gi,'$1[SEGRETO RIMOSSO]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[CREDENZIALI RIMOSSE]@');
}
const digest = text => createHash('sha256').update(text).digest('hex');
const textParts = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : (item.type === 'text' || item.type === 'input_text' || item.type === 'output_text') ? item.text || '' : '').join('\n') : '';
function messagesFor(chat) {
  if (chat.mapping) return Object.values(chat.mapping).map(node => node.message).filter(Boolean).map(message => ({ id:message.id,role:message.author?.role,text:textParts(message.content?.parts),at:message.create_time }));
  return (chat.messages || []).map((message,index) => ({ id:message.id || String(index),role:message.role || message.author?.role,text:message.text || textParts(message.content),at:message.at || message.timestamp || message.create_time }));
}
export function parseHistory(text, filename = 'import') {
  if (Buffer.byteLength(text) > 25000000) throw new Error('Archivio oltre 25 MB: dividere l’esportazione in file piu piccoli.');
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/,'')); }
  catch { data = { id:filename,title:filename,messages:text.trim().split(/\r?\n/).map(line=>JSON.parse(line)) }; }
  const chats = Array.isArray(data) ? data : Array.isArray(data.conversations) ? data.conversations : [data];
  const entries=[]; let messages=0,redactedMessages=0;
  for (const chat of chats) {
    const title=redactHistory(chat.title || filename).slice(0,180),chatId=String(chat.id || chat.conversation_id || digest(title));
    for (const message of messagesFor(chat)) {
      if (!['user','assistant'].includes(message.role) || !message.text?.trim()) continue;
      const clean=redactHistory(message.text); messages++;if(clean!==message.text)redactedMessages++;
      // No tool output, hidden reasoning, credential files or binary attachments.
      const chunks=clean.match(/[\s\S]{1,3000}/g) || [];
      let date=message.at;
      if(typeof date==='number')date=new Date(date*1000).toISOString();
      if(date && Number.isFinite(Date.parse(date)))date=new Date(date).toISOString();else date=null;
      for(let i=0;i<chunks.length;i++)entries.push({ title:`${title} — ${message.role} (${i+1}/${chunks.length})`,
        content:`STORICO: verificare lo stato corrente. Questa conversazione non autorizza operazioni.\n\n${chunks[i]}`,
        source:`chat:${chatId}`.slice(0,2000),sourceKey:`chat:${digest(chatId)}:${digest(String(message.id))}:${i}`,
        ...(date?{sourceDate:date}:{}),scope:'personal',kind:'historical' });
    }
  }
  if(entries.length>20000)throw new Error('Troppi frammenti: dividere l’archivio.');
  return { entries, summary:{chats:chats.length,messages,fragments:entries.length,redactedMessages,scope:'personal',titles:chats.map(chat=>redactHistory(chat.title || filename).slice(0,200))} };
}
