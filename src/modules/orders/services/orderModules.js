export const ORDER_MODULE_DEFINITIONS = Object.freeze({
  prof: Object.freeze({ workspaceCode: "ordini_pr", integrationCode: "gestione_ordini_pr", mexalModule: "ORDINIPR", title: "Ordini PR", documentTypes: Object.freeze(["OCM", "OCX", "OCI"]), mexalReconciliation: true }),
  ph: Object.freeze({ workspaceCode: "ordini_ph", integrationCode: "gestione_ordini_ph", mexalModule: "ORDINIPH", title: "Ordini PH", documentTypes: Object.freeze([]), mexalReconciliation: false }),
  private: Object.freeze({ workspaceCode: "ordini_private", integrationCode: "gestione_ordini_private", mexalModule: "ORDINIPRIVATE", title: "OrdiniPrivate", documentTypes: Object.freeze(["OCT"]), mexalReconciliation: true }),
});

export function orderModuleDefinition(moduleCode = "prof") {
  return ORDER_MODULE_DEFINITIONS[moduleCode] || ORDER_MODULE_DEFINITIONS.prof;
}

export function orderModuleFilter(moduleCode = "prof") {
  const resolvedModule = ORDER_MODULE_DEFINITIONS[moduleCode] ? moduleCode : "prof";
  return `modulo_ordini.eq.${resolvedModule}`;
}

export function orderBelongsToModule(moduleCode = "prof", order = {}) {
  const storedModule = String(order.modulo_ordini || "").trim().toLowerCase();
  if (storedModule !== moduleCode) return false;
  return moduleCode !== "prof" || String(order.origine || "").trim().toLowerCase() !== "mexal_oct";
}

export function filterOrderModuleRows(moduleCode = "prof", rows = []) {
  return rows.filter((order) => orderBelongsToModule(moduleCode, order));
}

export function isPrivateOrderModule(moduleCode) {
  return moduleCode === "private";
}

export function orderModuleUsesMexalReconciliation(moduleCode = "prof") {
  return orderModuleDefinition(moduleCode).mexalReconciliation;
}

export function orderModuleDocumentTypes(moduleCode = "prof") {
  return orderModuleDefinition(moduleCode).documentTypes;
}

export function orderModuleAcceptsDocument(moduleCode, documentType) {
  return orderModuleDocumentTypes(moduleCode).includes(String(documentType || "").trim().toUpperCase());
}

export function filterOrderModuleDocuments(moduleCode, documents = []) {
  return documents.filter((document) => orderModuleAcceptsDocument(moduleCode, document?.tipo_documento));
}

export function orderModuleCodeFromOrder(order = {}) {
  const moduleCode = String(order.modulo_ordini || "prof").trim().toLowerCase();
  return ORDER_MODULE_DEFINITIONS[moduleCode] ? moduleCode : "prof";
}
