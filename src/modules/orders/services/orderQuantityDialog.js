let pendingDialog = null;
export function isOrderQuantityError(error) {
  return /Quantità inserita:/i.test(String(error?.message || error || ''));
}
export function showOrderQuantityError(message, { alert = globalThis.window?.workspaceAlert } = {}) {
  if (pendingDialog) return pendingDialog;
  pendingDialog = Promise.resolve(alert?.(String(message), {
    title: 'Quantità non consentita', variant: 'danger', viewportCentered: true,
  })).finally(() => { pendingDialog = null; });
  return pendingDialog;
}
export function showCartonViolations(violations, options) {
  return showOrderQuantityError(violations.map(item => item.message).join('\n\n'), options);
}
