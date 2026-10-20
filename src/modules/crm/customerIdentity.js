const ORIGINS = { woocommerce: 'salidischia.it', amazon_sp_api: 'Amazon', amazon: 'Amazon', mailchimp: 'Mailchimp', mexal: 'Mexal', workspace: 'Workspace', crm_only: 'Inserimento manuale' };

export function customerOrigin(account) {
  if (account?.codice_cliente_mexal || account?.entity_kind === 'canonical') return 'Mexal';
  return ORIGINS[account?.fonte] || account?.fonte || 'Origine non disponibile';
}

export function customerDisplayName(account) {
  if (account?.entity_kind === 'canonical' || account?.codice_cliente_mexal) return account.nome || 'Nominativo non disponibile';
  const profile = account?.metadati?.anagrafica || {};
  const name = [profile.cognome, profile.nome].filter(Boolean).join(' ').trim();
  if (name) return name;
  const saved = String(account?.nome || '').trim();
  return saved && !saved.includes('@') ? saved : 'Nominativo non disponibile';
}
