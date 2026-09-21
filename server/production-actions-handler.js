import { handlePreparationActions } from './preparation-actions.js';
import { handlePackagingActions } from './packaging-actions.js';
import { handlePackagingSheet } from './packaging-sheet.js';

// Keep interactive production requests independent from the automation bundle.
export function createProductionActionsHandler(handlers = {
  preparation_actions: handlePreparationActions,
  packaging_actions: handlePackagingActions,
  packaging_sheet: handlePackagingSheet,
}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ success: false, error: 'Metodo non consentito.' });
    }
    const body = req.body || {};
    const handler = Object.hasOwn(handlers, body.action) && handlers[body.action];
    if (!handler) return res.status(400).json({ success: false, error: 'Operazione non valida.' });
    const started = Date.now();
    try {
      const result = await handler(req, body);
      res.setHeader('Server-Timing', `production;dur=${Date.now() - started}`);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      const status = Number(error?.status);
      return res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500)
        .json({ success: false, error: error?.message || 'Operazione MES non riuscita.' });
    }
  };
}

export default createProductionActionsHandler();
