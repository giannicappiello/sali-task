const SENSITIVE = /password|passwd|secret|token|authorization|api.?key|credenzial/i;
export function activeWorkspaceDialogs(doc) {
  return [...doc.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open],.modal-backdrop > .modal-card,.letterhead-modal > .letterhead-dialog,.private-upload-modal > form')]
    .filter(el => !el.closest('[data-workspace-assistant]') && !el.hidden && el.getClientRects().length > 0)
    .filter((el, _, all) => !all.some(other => other !== el && el.contains(other)));
}
export function captureAssistantContext({ dialog, path, title, module }, doc = document) {
  const dialogs = activeWorkspaceDialogs(doc);
  const root = dialog?.isConnected ? dialog : dialogs.at(-1) || doc.querySelector('.content-area') || doc.querySelector('main');
  if (!root) return { system:'workspace', path, title, module, fields:[] };
  const fields = [...root.querySelectorAll('input,select,textarea')].filter(el => {
    const label = [el.type,el.name,el.id,el.autocomplete,el.getAttribute('aria-label')].join(' ');
    return !el.closest('[data-workspace-assistant],[hidden],[aria-hidden="true"]') && el.getClientRects().length > 0 && !['hidden','password','file'].includes(el.type) && !SENSITIVE.test(label);
  }).slice(0,80).map(el => ({
    label: el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.placeholder || el.name || 'Campo',
    value: String(['checkbox','radio'].includes(el.type) ? el.checked : el.tagName === 'SELECT' ? [...el.selectedOptions].map(o => o.textContent).join(', ') : el.value || '').slice(0,2000),
    unsaved: ['checkbox','radio'].includes(el.type) ? el.checked !== el.defaultChecked : el.tagName === 'SELECT' ? [...el.options].some(o => o.selected !== o.defaultSelected) : el.value !== el.defaultValue,
  })).filter(field => !SENSITIVE.test(field.label));
  const clone = root.cloneNode(true);
  clone.querySelectorAll('input,select,textarea,script,style,[hidden],[aria-hidden="true"],[data-workspace-assistant]').forEach(el => el.remove());
  return { system:'workspace',path,title:root.getAttribute('aria-label') || root.querySelector('h1,h2,h3')?.textContent || title,module,
    screenCode:root.dataset.screenCode || root.querySelector('[data-screen-code]')?.dataset.screenCode || '',
    recordId:root.dataset.recordId || root.querySelector('[data-record-id]')?.dataset.recordId || '',
    targetType:root.dataset.layoutTargetType || root.querySelector('[data-layout-target-type]')?.dataset.layoutTargetType || '',targetCode:root.dataset.layoutTargetCode || root.querySelector('[data-layout-target-code]')?.dataset.layoutTargetCode || '',
    visibleSummary:(clone.textContent || '').replace(/\s+/g,' ').slice(0,8000),fields,
    surface:dialogs.includes(root) ? 'popup':'page',capturedAt:new Date().toISOString() };
}
