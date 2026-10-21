import { purchasesByAccount, customerPurchases } from './customerPurchaseModel.js';
import { mailingByAccount } from './mailingModel.js';
import { customerDisplayName } from './customerIdentity.js';

export const deliveryLabel = status => ({sent: 'Inviata', hard: 'Rimbalzo permanente', soft: 'Rimbalzo temporaneo'}[status] || status || 'Non disponibile');
const italianDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
export function mailingOverview(identities, consents, deliveries, connections, period, orders = []) {
  const purchases = purchasesByAccount(orders, period.from, period.to);
  const purchaseFor = id => purchases.get(id) || customerPurchases([], period.from, period.to);
  const ids = new Set(connections.map(row => row.id));
  const scopedIdentities = identities.filter(row => ids.has(row.connection_id));
  const accounts = new Map();
  for (const identity of scopedIdentities) {
    if (identity.account_id && !accounts.has(identity.account_id)) accounts.set(identity.account_id, identity.crm_accounts || { id: identity.account_id });
  }
  const scopedConsents = consents.filter(row => accounts.has(row.account_id));
  const scopedDeliveries = deliveries.filter(row => ids.has(row.connection_id));
  const statuses = mailingByAccount(scopedConsents, scopedDeliveries, scopedIdentities, connections);
  const inPeriod = scopedDeliveries.filter(row => {
    if (!row.sent_at || !Number.isFinite(Date.parse(row.sent_at))) return false;
    const day = italianDate.format(new Date(row.sent_at));
    return day >= period.from && day <= period.to;
  });
  const campaigns = new Map();
  for (const row of inPeriod) {
    const key = row.connection_id + ':' + row.campaign_id;
    if (!campaigns.has(key)) campaigns.set(key, { id: key, title: row.title || row.campaign_id, sent_at: row.sent_at, recipients: [], sent: 0, bounced: 0, other: 0 });
    const campaign = campaigns.get(key);
    campaign.recipients.push({ ...row, purchases: purchaseFor(row.account_id), name: customerDisplayName(accounts.get(row.account_id)), email: accounts.get(row.account_id)?.email || '' });
    if (row.delivery_status === 'sent') campaign.sent++;
    else if (['hard', 'soft'].includes(row.delivery_status)) campaign.bounced++;
    else campaign.other++;
  }
  const contacts = [...accounts.values()].map(account => ({
    id: account.id, purchases: purchaseFor(account.id), name: customerDisplayName(account), email: account.email || '',
    ...statuses.get(account.id), receivedInPeriod: new Set(inPeriod.filter(row => row.account_id === account.id && row.delivery_status === 'sent').map(row => row.connection_id + ':' + row.campaign_id)).size,
  })).sort((a,b) => a.name.localeCompare(b.name, 'it'));
  return { contacts, subscribers: contacts.filter(row => row.subscribed === true),
    campaigns: [...campaigns.values()].sort((a,b) => String(b.sent_at).localeCompare(String(a.sent_at))),
    sent: inPeriod.filter(row => row.delivery_status === 'sent').length,
    bounced: inPeriod.filter(row => ['hard','soft'].includes(row.delivery_status)).length,
    totalCampaigns: new Set(scopedDeliveries.map(row => row.connection_id + ':' + row.campaign_id)).size,
    unlinked: scopedIdentities.filter(row => !row.account_id).length };
}
