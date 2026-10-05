import productionActions from '../../server/production-actions-handler.js';
import { handleInventorySnapshot } from '../../server/progremes-inventory.js';

export default async function handler(req, res) {
  if (req.query?.route === 'movement-contract-verification') {
    const { default: verify } = await import('../../server/mexal-movement-contract-verification.js');
    return verify(req, res);
  }
  if (req.query?.route === "progremes-inventory-snapshot") return handleInventorySnapshot(req, res);
  if (req.query?.route === 'production-actions' ||
      (!req.query?.route && ['preparation_actions', 'packaging_actions', 'packaging_sheet', 'batch_sheet'].includes(req.body?.action))) {
    return productionActions(req, res);
  }
  const { default: automation } = await import('../../server/mexal/automation-handler.js');
  return automation(req, res);
}
