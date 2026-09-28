// Customer associations take precedence over the user's operative role.
export function isCustomerRecordScope(scope) {
  return scope?.mode === 'cliente' || Boolean(scope?.customerCode || scope?.customerCodes?.length);
}
