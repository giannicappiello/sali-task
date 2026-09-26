// Page-owned draft; never persisted or treated as authorization.
let current = null;
const listeners = new Set();
export const getCostAssistantDraft = () => current;
export const subscribeCostAssistantDraft = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export function publishCostAssistantDraft(value) { current = value; listeners.forEach(listener => listener()); }
