export const ORDER_MODULE_DEFINITIONS = Object.freeze({
  prof: Object.freeze({ workspaceCode: "ordini_pr", integrationCode: "gestione_ordini_pr", mexalModule: "ORDINIPR", title: "Ordini PR" }),
  ph: Object.freeze({ workspaceCode: "ordini_ph", integrationCode: "gestione_ordini_ph", mexalModule: "ORDINIPH", title: "Ordini PH" }),
  private: Object.freeze({ workspaceCode: "ordini_private", integrationCode: "gestione_ordini_private", mexalModule: "ORDINIPRIVATE", title: "OrdiniPrivate" }),
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
