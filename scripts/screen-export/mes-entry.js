import { installScreenExport } from '../../shared/screen-export/ui.js';
const script = document.querySelector('script[data-progre-export]');
installScreenExport({ system: 'ProgreMES', logoUrl: '/images/report-progre-logo.png', frameOrigin: script?.dataset.workspaceOrigin, requireAuthentication: true });
