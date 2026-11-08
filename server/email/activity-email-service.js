const PUBLIC_COLUMNS = 'id,source_kind,delegation_id,delegation_policy_hash,delegation_policy_version,task_id,author_id,confirmed_by,recipient,subject,body,via_ai,status,idempotency_key,task_snapshot,payload_hash,created_at,confirmed_at,claimed_at,accepted_at,provider_message_id,error_code';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireValue(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
function uuid(value) { requireValue(typeof value === 'string' && UUID.test(value), 'Identificativo non valido.'); return value; }
function checked(result) {
  if (result.error) {
    const raw = String(result.error.message || '');
    const code = /^(EMAIL_PERMISSION_REQUIRED|AI_EMAIL_PERMISSION_REQUIRED|TASK_NOT_ACCESSIBLE|EMAIL_NOT_ACCESSIBLE|IDEMPOTENCY_CONFLICT|EMAIL_PROPOSAL_EXPIRED|TASK_CHANGED|EMAIL_CHANGED|IMMUTABLE_EMAIL_PROPOSAL|FORBIDDEN)$/.test(raw) ? raw : 'Operazione email non riuscita.';
    throw Object.assign(new Error(code), {status: /FORBIDDEN|PERMISSION|NOT_ACCESSIBLE/.test(code) ? 403 : /CHANGED|CONFLICT|EXPIRED/.test(code) ? 409 : code === raw ? 400 : 500});
  }
  return result.data;
}
export function hashActivityEmail(row) {
  requireValue(/^[a-f0-9]{64}$/.test(row?.payload_hash || ''), 'Hash proposta non valido.');
  return row.payload_hash;
}
export async function getActivityEmail(auth, id) {
  const row = checked(await auth.scoped.from('workspace_emails').select(PUBLIC_COLUMNS).eq('id', uuid(id)).maybeSingle());
  requireValue(row, 'Email non accessibile.', 404);
  return row;
}
export async function listActivityEmails(auth, {taskId, offset = 0}) {
  uuid(taskId);
  requireValue(Number.isInteger(offset) && offset >= 0 && offset <= 100000, 'Pagina non valida.');
  // The context RPC checks current task visibility even when history is empty.
  checked(await auth.scoped.rpc('workspace_activity_email_context', {p_task: taskId}));
  const rows = checked(await auth.scoped.from('workspace_emails').select(PUBLIC_COLUMNS).eq('task_id', taskId)
    .order('created_at', {ascending: false}).order('id', {ascending: false}).range(offset, offset + 20)) || [];
  return {emails: rows.slice(0, 20), nextOffset: rows.length > 20 ? offset + 20 : null};
}
export async function getActivityEmailContext(auth, {taskId}) {
  const context = checked(await auth.scoped.rpc('workspace_activity_email_context', {p_task: uuid(taskId)}));
  const {emails, nextOffset} = await listActivityEmails(auth, {taskId});
  return {...context, emails, nextOffset};
}
export async function proposeActivityEmail(auth, input, {viaAI = false} = {}) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input), 'Proposta non valida.');
  const allowed = ['taskId', 'recipient', 'subject', 'body', 'idempotencyKey'];
  requireValue(Object.keys(input).every(key => allowed.includes(key)), 'Campi email non supportati.');
  const {taskId, recipient, subject, body, idempotencyKey} = input;
  uuid(taskId);
  requireValue(typeof recipient === 'string' && recipient.length <= 254 && /^[^\s<>;,"@]+@[^\s<>;,"@]+\.[^\s<>;,"@]+$/.test(recipient), 'Indicare un solo indirizzo email.');
  requireValue(typeof subject === 'string' && subject.trim().length > 0 && subject.length <= 200 && ![...subject].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127), 'Oggetto non valido (massimo 200 caratteri).');
  requireValue(typeof body === 'string' && body.trim().length > 0 && body.length <= 12000 && !body.includes(String.fromCharCode(0)), 'Testo non valido (massimo 12000 caratteri).');
  requireValue(typeof idempotencyKey === 'string' && /^[A-Za-z0-9:_-]{8,128}$/.test(idempotencyKey), 'Chiave richiesta non valida.');
  // viaAI is an internal option, never copied from request input. SQL re-reads
  // capabilities, including on confirmation, rather than trusting auth's cache.
  return checked(await auth.scoped.rpc('workspace_propose_activity_email', {
    p_task: taskId, p_recipient: recipient, p_subject: subject, p_body: body,
    p_idempotency_key: idempotencyKey, p_via_ai: viaAI === true,
  }));
}
export async function decideActivityEmail(auth, {id, confirm, expectedHash}) {
  uuid(id);
  requireValue(typeof confirm === 'boolean', 'Decisione esplicita richiesta.');
  requireValue(typeof expectedHash === 'string' && /^[a-f0-9]{64}$/.test(expectedHash), 'Hash proposta non valido.');
  return checked(await auth.scoped.rpc('workspace_decide_activity_email', {p_id: id, p_confirm: confirm, p_expected_hash: expectedHash}));
}
