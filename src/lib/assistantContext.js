const SENSITIVE = /password|passwd|secret|token|authorization|api.?key|credenzial/i;
export function activeWorkspaceDialogs(doc) {
  return [...doc.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open],.modal.show .modal-content,.mud-dialog,.production-batch-inspector,.modal-backdrop > .modal-card,.letterhead-modal > .letterhead-dialog,.private-upload-modal > form')]
    .filter(el => !el.closest('[data-workspace-assistant],.workspace-context-ai-backdrop,[hidden],[aria-hidden="true"]') && !el.hidden && el.getClientRects().length > 0)
    .filter((el, _, all) => !all.some(other => other !== el && el.contains(other)));
}
export function captureAssistantContext({ dialog, path, title, module, system = 'workspace' }, doc = document) {
  const dialogs = activeWorkspaceDialogs(doc);
  const root = dialogs.includes(dialog) ? dialog : dialogs.at(-1) || doc.querySelector('.content-area') || doc.querySelector('main');
  if (!root) return { system, path, title, module, surface:'page', recordId:'', selection:'', visibleSummary:'', fields:[], capturedAt:new Date().toISOString() };
  const fields = [...root.querySelectorAll('input,select,textarea')].filter(el => {
    const label = [el.type,el.name,el.id,el.autocomplete,el.getAttribute('aria-label')].join(' ');
    return !el.closest('[data-workspace-assistant],[hidden],[aria-hidden="true"]') && el.getClientRects().length > 0 && !['hidden','password','file'].includes(el.type) && !SENSITIVE.test(label);
  }).slice(0,80).map(el => ({
    label: el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.placeholder || el.name || 'Campo',
    value: String(['checkbox','radio'].includes(el.type) ? el.checked : el.tagName === 'SELECT' ? [...el.selectedOptions].map(o => o.textContent).join(', ') : el.value || '').slice(0,2000),
    unsaved: ['checkbox','radio'].includes(el.type) ? el.checked !== el.defaultChecked : el.tagName === 'SELECT' ? [...el.options].some(o => o.selected !== o.defaultSelected) : el.value !== el.defaultValue,
  })).filter(field => !SENSITIVE.test(field.label));
  const clone = root.cloneNode(true);
  // A closed dialog or a CSS-hidden section must not leak stale records into
  // the visible page summary when the active popup has been closed.
  const originals = [...root.querySelectorAll('*')];
  [...clone.querySelectorAll('*')].forEach((el, i) => {
    const original = originals[i];
    if (!original.getClientRects().length || doc.defaultView?.getComputedStyle(original).visibility === 'hidden') el.remove();
  });
  clone.querySelectorAll('input,select,textarea,script,style,[hidden],[aria-hidden="true"],[data-workspace-assistant],.workspace-context-ai-backdrop,.assistant-popup-trigger').forEach(el => el.remove());
  const surface = dialogs.includes(root) ? 'popup' : 'page';
  const contextTitle = surface === 'popup' ? root.querySelector('h1,h2,h3')?.textContent || root.getAttribute('aria-label') || title : title;
  const metadata = root.matches('[data-record-id]') ? root : surface === 'popup'
    ? [...root.querySelectorAll('[data-record-id]')].find(el => el.getClientRects().length > 0) : null;
  const selection = metadata ? Object.entries(metadata.dataset).filter(([key]) => ['recordId','orderNumber','batchNumber','articleCode','phase','productionId'].includes(key)).map(([key, value]) => `${key}: ${value}`).join('; ') : '';
  return { system,path,title:contextTitle,module,selection,
    screenCode:root.dataset.screenCode || root.querySelector('[data-screen-code]')?.dataset.screenCode || '',
    recordId:metadata?.dataset.recordId || '',
    targetType:root.dataset.layoutTargetType || root.querySelector('[data-layout-target-type]')?.dataset.layoutTargetType || '',targetCode:root.dataset.layoutTargetCode || root.querySelector('[data-layout-target-code]')?.dataset.layoutTargetCode || '',
    visibleSummary:(clone.textContent || '').replace(/\s+/g,' ').slice(0,8000),fields,
    surface,capturedAt:new Date().toISOString() };
}
