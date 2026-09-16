export const AGREEMENT_FIELDS = [
  ['site_id', 'Sede · nome della sede configurata'], ['weekly_hours', 'Ore pattuite / settimana'],
  ['weekdays', 'Giorni lavorativi · 1=lunedì … 7=domenica, separati da virgola'],
  ['start_time', 'Orario pattuito · ingresso (HH:MM)'], ['end_time', 'Orario pattuito · uscita (HH:MM)'],
  ['break_minutes', 'Pausa non lavorata · minuti'], ['agreed_pay', 'Compenso pattuito · EUR'],
  ['pay_period', 'Periodicità compenso · mensile, oraria, annuale'],
  ['overtime_mode', 'Gestione straordinario · retribuito, banca ore, non abilitato'],
  ['overtime_rate', 'Tariffa base straordinario · EUR/ora'], ['overtime_percent', 'Maggiorazione straordinario · %'],
];
const labels = { month: 'Mensile', hour: 'Oraria', year: 'Annuale', paid: 'Retribuito', bank: 'Banca ore', disabled: 'Non abilitato' };
export function agreementValues(contract, sites = []) {
  return Object.fromEntries(AGREEMENT_FIELDS.map(([key]) => {
    let value = contract?.agreement_fields?.[key] ?? contract?.[key] ?? '';
    if (key === 'site_id') value = sites.find(s => s.id === value)?.name ?? value;
    if (Array.isArray(value)) value = value.join(',');
    if (['pay_period', 'overtime_mode'].includes(key)) value = labels[value] ?? value;
    return [key, String(value)];
  }));
}
export function agreementDisplay(contract, key, sites) {
  return agreementValues(contract, sites)[key] || '—';
}
export function overtimeValue(contract, hours) {
  if (contract?.overtime_mode !== 'paid') return '—';
  if (contract.overtime_rate == null || contract.overtime_percent == null) return 'Da definire';
  return (hours * contract.overtime_rate * (1 + contract.overtime_percent / 100)).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}
