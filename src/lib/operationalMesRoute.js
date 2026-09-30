// UI entry only: the SSO endpoint still verifies the active user's department.
export function operationalMesRoute(pathname, search = '') {
  if (pathname !== '/produzione/progremes.PlanningProduction') return false;
  const params = new URLSearchParams(search);
  const destination = params.get('destination');
  if (['station-overview', 'filling-overview'].includes(destination))
    return [...params.keys()].every(key => ['destination', 'workspaceMesWindow'].includes(key));
  if (destination !== 'station' || !/^(?:ST|STATION)\s*0*[1-9]\d*$/.test(params.get('station') || '')) return false;
  if (![...params.keys()].every(key => ['destination', 'station', 'stationAction', 'orderId', 'workspaceMesWindow'].includes(key))) return false;
  if (!params.has('stationAction') && !params.has('orderId')) return true;
  const id = Number(params.get('orderId'));
  return ['start', 'close'].includes(params.get('stationAction')) && Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
}
