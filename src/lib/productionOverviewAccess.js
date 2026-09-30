const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function productionOverviewAccess({ admin = false, role = '', areas = [], departments = [], planning = false, customer = false } = {}) {
  if (customer) return { station: false, filling: false };
  if (admin) return { station: true, filling: true };
  const name = normalize(role);
  if (name === 'addettomiscelazione') return { station: true, filling: false };
  if (name === 'addettoconfezionamento') return { station: false, filling: true };
  const tags = [name, ...areas.map(normalize), ...departments.map(normalize)];
  const all = tags.some(v => ['produzione', 'addettoproduzione'].includes(v));
  const station = all || tags.some(v => ['miscelazione', 'addettomiscelazione'].includes(v));
  const filling = all || tags.some(v => ['confezionamento', 'addettoconfezionamento'].includes(v));
  return station || filling ? { station, filling } : { station: planning, filling: planning };
}

export function productionOverviewKind(path, origin = 'https://workspace.invalid') {
  try {
    const url = new URL(path, origin);
    if (url.origin !== origin) return '';
    if (url.pathname === '/produzione/miscelazione') return 'station';
    if (url.pathname === '/produzione/filling') return 'filling';
    if (url.pathname !== '/produzione/progremes.PlanningProduction') return '';
    return ({'station-overview':'station','filling-overview':'filling'})[url.searchParams.get('destination')] || '';
  } catch { return ''; }
}
