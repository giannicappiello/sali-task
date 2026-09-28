import { prepareProductionDemand } from './production-netting.js';
import { createWorkspaceV4Preview } from './workspacemes-v4-api.js';

// Shared by the OCT workbench and the assistant. Creation never confirms a
// forecast, creates an OP, starts a phase or generates warehouse movements.
export async function createWorkspaceRdp({ admin, orderIds = [], lineIds = [], snapshotId, requestedBy, recordRpc, validateDemand }, {
  prepare = prepareProductionDemand, preview = createWorkspaceV4Preview,
} = {}) {
  const prepared = await prepare({ admin, orderIds, lineIds, expectedSnapshotId: snapshotId, requestedBy, mode: 'create', recordRpc, validateDemand });
  const requestId = prepared.request?.id;
  if (!requestId) throw Object.assign(new Error('Creazione RdP V4 non confermata.'), { code: 'V4_REQUEST_FAILED' });
  let v4Preview, previewError;
  try { v4Preview = await preview({ admin, requestId, requestedBy }); }
  catch (error) { previewError = { code: error.code || 'V4_PREVIEW_FAILED', message: error.message }; }
  const status = v4Preview?.status || 'BLOCKED';
  const { error } = await admin.from('workspace_production_requests').update({
    stato: status, workspace_status: status, last_error_code: previewError?.code || null,
    last_response: { contractVersion: 4, ...(previewError ? { error: previewError.message, code: previewError.code }
      : { previewId: v4Preview.id, status }) }, updated_at: new Date().toISOString(),
  }).eq('id', requestId);
  if (error) throw error;
  return { requestId, externalId: prepared.request.external_id, status, ...(previewError ? { previewError } : { v4Preview }), productionCreated: false };
}
