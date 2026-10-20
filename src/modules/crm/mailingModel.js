export const EMPTY_MAILING = { label: 'Dato non disponibile', subscribed: null, received: null, partial: true, audiences: [], deliveries: [] };
export function mailingByAccount(consents, deliveries, identities, connections) {
  const result = new Map();
  const complete = new Set(connections.filter(row => row.import_state?.mailing_complete).map(row => row.id));
  const entry = id => { if (!result.has(id)) result.set(id, { ...EMPTY_MAILING, audiences: [], deliveries: [], connectionIds: new Set() }); return result.get(id); };
  for (const identity of identities) if (identity.account_id) entry(identity.account_id).connectionIds.add(identity.connection_id);
  const latest = new Map();
  for (const consent of consents) {
    if (!consent.account_id || !String(consent.source || '').startsWith('mailchimp:')) continue;
    const key = `${consent.account_id}:${consent.source}`;
    const time = row => Math.max(Date.parse(row.captured_at) || 0, Date.parse(row.withdrawn_at) || 0, Date.parse(row.created_at) || 0);
    if (!latest.has(key) || time(consent) > time(latest.get(key))) latest.set(key, consent);
  }
  for (const row of latest.values()) entry(row.account_id).audiences.push(row);
  for (const row of deliveries) if (row.account_id) entry(row.account_id).deliveries.push(row);
  for (const row of result.values()) {
    row.partial = !row.connectionIds.size || [...row.connectionIds].some(id => !complete.has(id));
    const granted = row.audiences.filter(item => item.status === 'granted').length;
    row.subscribed = row.audiences.length ? granted > 0 : null;
    row.label = granted ? `Iscritto${row.audiences.length > 1 ? ` (${granted}/${row.audiences.length} audience)` : ''}` : row.audiences.some(item => item.status === 'withdrawn') ? 'Disiscritto' : row.audiences.some(item => item.status === 'denied') ? 'Non iscritto' : row.audiences.length ? 'In attesa / non confermato' : 'Dato non disponibile';
    const sent = new Set(row.deliveries.filter(item => item.delivery_status === 'sent').map(item => `${item.connection_id}:${item.campaign_id}`));
    row.received = sent.size || !row.partial ? sent.size : null;
  }
  return result;
}
