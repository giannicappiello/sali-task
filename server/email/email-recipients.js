export const MAX_EMAIL_RECIPIENTS = 30;
const EMAIL = /^[^\s<>;,"@]+@[^\s<>;,"@]+\.[^\s<>;,"@]+$/;
const V2_EMAIL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
function requireValue(condition, message) {
  if (!condition) throw Object.assign(new Error(message), {status: 400});
}
function address(value, normalize = true) {
  requireValue(typeof value === 'string' && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127), 'Indirizzo email non valido.');
  const result = normalize ? value.trim().toLowerCase() : value;
  requireValue(result.length <= 254 && (normalize ? V2_EMAIL.test(result) && result.split('@')[0].length <= 64 : EMAIL.test(result)), 'Indirizzo email non valido.');
  return result;
}
// Never silently drop recipients, change their roles or reinterpret old requests.
export function normalizeEmailRecipients(input) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input), 'Destinatari non validi.');
  if (Object.hasOwn(input, 'recipient')) {
    requireValue(!Object.hasOwn(input, 'to') && !Object.hasOwn(input, 'cc'), 'Usare recipient oppure to e cc, non entrambi.');
    return {recipient: address(input.recipient, false), protocol: 1};
  }
  requireValue(Array.isArray(input.to) && input.to.length > 0 && (!Object.hasOwn(input, 'cc') || Array.isArray(input.cc)), 'Indicare almeno un destinatario To e CC come lista.');
  const ccInput = input.cc ?? [];
  requireValue(input.to.length + ccInput.length <= MAX_EMAIL_RECIPIENTS, `Massimo ${MAX_EMAIL_RECIPIENTS} destinatari tra To e CC.`);
  const to = input.to.map(value => address(value));
  const cc = ccInput.map(value => address(value));
  requireValue(new Set([...to, ...cc]).size === to.length + cc.length, 'Destinatari duplicati tra To e CC.');
  return {to, cc, recipient: to[0], protocol: 2};
}
export const emailRecipientSchema = {
  recipient: {type: 'string', format: 'email', maxLength: 254},
  to: {type: 'array', minItems: 1, maxItems: MAX_EMAIL_RECIPIENTS, uniqueItems: true, items: {type: 'string', format: 'email', maxLength: 254}},
  cc: {type: 'array', maxItems: MAX_EMAIL_RECIPIENTS, uniqueItems: true, items: {type: 'string', format: 'email', maxLength: 254}},
};
export const emailRecipientAlternatives = [
  {required: ['recipient'], not: {anyOf: [{required: ['to']}, {required: ['cc']}]}},
  {required: ['to'], not: {required: ['recipient']}},
];
