export const AGREEMENT_FIELDS = [
  ['site_id', 'Sede · nome della sede configurata'], ['weekly_hours', 'Ore pattuite / settimana'],
  ['weekdays', 'Giorni lavorativi · 1=lunedì … 7=domenica, separati da virgola'],
  ['start_time', 'Orario pattuito · ingresso (HH:MM)'], ['end_time', 'Orario pattuito · uscita (HH:MM)'],
  ['break_minutes', 'Pausa non lavorata · minuti'], ['agreed_pay', 'Compenso pattuito · EUR'],
  ['pay_period', 'Periodicità compenso · mensile, oraria, annuale'],
  ['overtime_separate', 'Gestisci Straordinario Separatamente'],
  ['overtime_rate', 'Tariffa base straordinario · EUR/ora'], ['overtime_percent', 'Maggiorazione straordinario · %'],
];
const labels = { month: 'Mensile', hour: 'Oraria', year: 'Annuale', paid: 'Retribuito', bank: 'Banca ore', disabled: 'Non abilitato' };
export const separateOvertime = contract => contract?.overtime_separate === true;
export function agreementForDay(contracts = [], userId, day) {
  return contracts.filter(c => c.user_id === userId && c.effective_from <= day)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || (b.created_at || '').localeCompare(a.created_at || '') || String(b.id || '').localeCompare(String(a.id || '')))[0];
}
export function agreementValues(contract, sites = []) {
  return Object.fromEntries(AGREEMENT_FIELDS.map(([key]) => {
    if (key === 'overtime_separate') return [key, separateOvertime(contract)];
    let value = contract?.agreement_fields?.[key] ?? contract?.[key] ?? '';
    if (key === 'site_id') value = sites.find(s => s.id === value)?.name ?? value;
    if (Array.isArray(value)) value = value.join(',');
    if (['pay_period', 'overtime_mode'].includes(key)) value = labels[value] ?? value;
    return [key, String(value)];
  }));
}
export function agreementDisplay(contract, key, sites) {
  if (key === 'overtime_separate') return separateOvertime(contract) ? 'Sì' : 'No';
  if (key === 'overtime_mode') return labels[contract?.overtime_mode] || contract?.agreement_fields?.overtime_mode || '—';
  return agreementValues(contract, sites)[key] || '—';
}
export function overtimeValue(contract, hours) {
  if (!separateOvertime(contract) && contract?.overtime_mode !== 'paid') return '—';
  if (contract.overtime_rate == null || contract.overtime_percent == null) return 'Da definire';
  return (hours * contract.overtime_rate * (1 + contract.overtime_percent / 100)).toLocaleString('it-IT', { useGrouping: 'always',  style: 'currency', currency: 'EUR' });
}
