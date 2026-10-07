// Provider diagnostics are kept server-side; the operator receives a short, actionable message.
const quotaCodes = new Set(['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded']);
export function aiErrorMessage(error) {
  const nested = [error, error?.error, error?.cause, error?.data?.error, error?.cause?.data?.error].filter(Boolean);
  for (const item of nested) {
    if (quotaCodes.has(item.code) || quotaCodes.has(item.type)) return 'Credito AI esaurito.';
    const message = String(item.message || '');
    if (/organization has reached a usage or billing limit|exceeded your current quota|insufficient_quota|credit balance (?:is )?exhausted|(?:billing|spend|usage) limit (?:has been )?(?:reached|exceeded)/i.test(message))
      return 'Credito AI esaurito.';
  }
  return error?.message || 'Richiesta AI non riuscita.';
}

