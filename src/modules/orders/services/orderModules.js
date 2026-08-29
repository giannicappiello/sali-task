export const ORDER_MODULE_DEFINITIONS = Object.freeze({
  prof: Object.freeze({ workspaceCode: "ordini_pr", integrationCode: "gestione_ordini_pr", mexalModule: "ORDINIPR", title: "Ordini PR", documentTypes: Object.freeze(["OCM", "OCX", "OCI"]) }),
  ph: Object.freeze({ workspaceCode: "ordini_ph", integrationCode: "gestione_ordini_ph", mexalModule: "ORDINIPH", title: "Ordini PH", documentTypes: Object.freeze(["OCM", "OCX", "OCI"]) }),
  private: Object.freeze({ workspaceCode: "ordini_private", integrationCode: "gestione_ordini_private", mexalModule: "ORDINIPRIVATE", title: "OrdiniPrivate", documentTypes: Object.freeze(["OCT"]) }),
});

export function orderModuleDefinition(moduleCode = "prof") {
  return ORDER_MODULE_DEFINITIONS[moduleCode] || ORDER_MODULE_DEFINITIONS.prof;
}

export function orderModuleFilter(moduleCode = "prof") {
  return moduleCode === "prof" ? "modulo_ordini.eq.prof,modulo_ordini.is.null" : `modulo_ordini.eq.${moduleCode}`;
}

export function isPrivateOrderModule(moduleCode) {
  return moduleCode === "private";
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
