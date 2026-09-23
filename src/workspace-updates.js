import { registerSW } from 'virtual:pwa-register';
let notice;
let updateWorker;
export function showUpdateNotice(stale = false) {
  if (notice && (!stale || notice.dataset.stale === 'true')) return;
  if (notice) notice.remove();
  notice = document.createElement('aside');
  notice.className = 'workspace-update-notice';
  notice.dataset.stale = String(stale);
  notice.setAttribute('role', 'status');
  const text = document.createElement('div');
  text.textContent = stale ? 'Il modulo non è disponibile. Puoi riprovare oppure aggiornare l’app dopo aver salvato il lavoro.' : 'È disponibile una nuova versione. Salva il lavoro prima di aggiornare.';
  const update = document.createElement('button'); update.textContent = 'Aggiorna app';
  update.onclick = async () => {
    if (!window.confirm('Hai salvato il lavoro? L’aggiornamento ricarica la pagina.')) return;
    if (updateWorker) await updateWorker(true); else window.location.reload();
  };
  notice.append(text, update);
  if (stale) {
    const retry = document.createElement('button'); retry.textContent = 'Riprova';
    retry.onclick = () => { notice.remove(); notice = null; window.dispatchEvent(new Event('workspace:retry-module')); };
    notice.append(retry);
  } else {
    const later = document.createElement('button'); later.textContent = 'Più tardi';
    later.onclick = () => { notice.remove(); notice = null; }; notice.append(later);
  }
  document.body.append(notice);
}
export function waitForModuleRetry() {
  showUpdateNotice(true);
  return new Promise(resolve => window.addEventListener('workspace:retry-module', resolve, { once: true }));
}
export function registerWorkspaceUpdates() {
  const update = registerSW({ onNeedRefresh() { updateWorker = update; showUpdateNotice(); } });
}
