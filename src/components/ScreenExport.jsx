import { useEffect } from 'react';
import { installScreenExport } from '../../shared/screen-export/ui.js';
import { composeWorkspacePdf } from '../services/companyDocuments.js';

export default function ScreenExport() {
  useEffect(() => installScreenExport({ system: 'Workspace', composePdf: async (pdf, options) => {
    const result = await composeWorkspacePdf({ pdf, ...options, documentTypeCode: 'REPORT_SCHERMATA', documentExternalId: 'screen-report:' + crypto.randomUUID(), brand: 'PROGRE', businessArea: 'assistente_ai', language: 'it' });
    return result.blob;
  } }), []);
  return null;
}
