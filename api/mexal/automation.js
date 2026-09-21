import productionActions from '../../server/production-actions-handler.js';

export default async function handler(req, res) {
  if (req.query?.route === 'production-actions' ||
      (!req.query?.route && ['preparation_actions', 'packaging_actions', 'packaging_sheet'].includes(req.body?.action))) {
    return productionActions(req, res);
  }
  const { default: automation } = await import('../../server/mexal/automation-handler.js');
  return automation(req, res);
}
