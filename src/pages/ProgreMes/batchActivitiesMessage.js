import { fillingActivityMessage } from './fillingActivityMessage.js';
import { stationPanelUrl } from '../Dashboard/productionCalendar.js';

const phases = { Production: ['Preparazione', 0], Packaging: ['Confezionamento', 3], Cartoning: ['Astucciatura', 7] };

export function batchActivitiesMessage(data) {
  if (data?.type !== 'progremes-batch-activities' || !Array.isArray(data.activities)
    || !data.activities.length || data.activities.length > 3) return null;
  const activities = [];
  for (const value of data.activities) {
    const phase = phases[value?.operationType];
    if (!phase || !Number.isSafeInteger(value.batchNumber) || value.batchNumber <= 0) return null;
    const activity = fillingActivityMessage({ type: 'progremes-filling-activity', activity: {
      ...value, operationType: value.operationType === 'Production' ? 'Packaging' : value.operationType,
    } });
    if (!activity) return null;
    if (activities.some(a => a.operationType === value.operationType)
      || activities.some(a => a.productionOrderId !== value.productionOrderId || a.batchNumber !== value.batchNumber)) return null;
    activities.push({ ...activity, operationType: value.operationType, reparto: phase[0],
      panelUrl: stationPanelUrl(value.operationType, value.resourceCode),
      id: `${value.productionOrderId}-${value.batchNumber}-${value.operationType}` });
  }
  return activities.sort((a, b) => phases[a.operationType][1] - phases[b.operationType][1]);
}
