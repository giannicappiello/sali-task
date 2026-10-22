import productionActions from '../../server/production-actions-handler.js';
import { handleInventorySnapshot } from '../../server/progremes-inventory.js';

export default async function handler(req, res) {
  if (req.query?.route === 'direct-product-sheets') {
    const { handleDirectProductSheets } = await import('../../server/direct-product-sheets.js');
    return handleDirectProductSheets(req, res);
  }
  if (req.query?.route === 'club-supply-order') {
    const { handleClubSupply } = await import('../../server/club-supply-orders.js');
    return handleClubSupply(req, res);
  }
  if (req.query?.route === 'oct-reconciliation') {
    const { handleOctReconciliation } = await import('../../server/workspacemes-oct-reconciliation.js');
    return handleOctReconciliation(req, res);
  }
  if (req.query?.route === "progremes-inventory-snapshot") return handleInventorySnapshot(req, res);
  if (req.query?.route === 'production-actions' ||
      (!req.query?.route && ['preparation_actions', 'packaging_actions', 'packaging_sheet', 'batch_sheet'].includes(req.body?.action))) {
    return productionActions(req, res);
  }
  const { default: automation } = await import('../../server/mexal/automation-handler.js');
  return automation(req, res);
}
