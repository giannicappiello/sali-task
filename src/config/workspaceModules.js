export const WORKSPACE_MODULES = Object.freeze({
  home: { code: "home", label: "Home", kind: "system", alwaysAvailable: true },
  attivita: { code: "attivita", label: "Attività", kind: "business", alwaysAvailable: true, roleConfigurable: true, selfServiceLevel: "scrittura" },
  prodotti: { code: "prodotti", label: "Prodotti Direct", kind: "business", departmentAssignable: true, roleConfigurable: true },
  magazzino: { code: "magazzino", label: "Magazzino", kind: "business", departmentAssignable: true, roleConfigurable: true },
  documenti: { code: "documenti", label: "Documenti Direct", kind: "business", departmentAssignable: true, roleConfigurable: true },
  assistente_ai: { code: "assistente_ai", label: "Assistente AI", kind: "business", departmentAssignable: true, roleConfigurable: true },
  messaggi: { code: "messaggi", label: "Messaggi", kind: "business", alwaysAvailable: true, roleConfigurable: true, selfServiceLevel: "scrittura" },
  notifiche: { code: "notifiche", label: "Notifiche", kind: "system", alwaysAvailable: true },
  beauty_days: { code: "beauty_days", label: "Beauty Days", kind: "business", departmentAssignable: true, roleConfigurable: true },
  ordini_pr: { code: "ordini_pr", label: "Ordini PR", kind: "business", departmentAssignable: true, roleConfigurable: true },
  ordini_ph: { code: "ordini_ph", label: "Ordini PH", kind: "business", departmentAssignable: true, roleConfigurable: true },
  ordini_private: { code: "ordini_private", label: "OrdiniPrivate", kind: "business", departmentAssignable: true, roleConfigurable: true },
  progremes: { code: "progremes", label: "ProgreMES APS", kind: "business", departmentAssignable: true, transitional: true },
  team: { code: "team", label: "Team", kind: "business", departmentAssignable: true, roleConfigurable: true },
  integrazioni: { code: "integrazioni", label: "Integrazioni", kind: "administration", roleConfigurable: true },
  impostazioni: { code: "impostazioni", label: "Impostazioni", kind: "administration", alwaysAvailable: true },
});

export const WORKSPACE_FEATURES = Object.freeze({
  analisi_dati: {
    code: "analisi_dati",
    label: "Analisi dati",
    kind: "container",
    requiresModules: ["attivita"],
  },
});

export const DEPARTMENT_ASSIGNABLE_MODULES = Object.freeze(
  Object.values(WORKSPACE_MODULES).filter((module) => module.departmentAssignable)
);

export const ROLE_CONFIGURABLE_MODULES = Object.freeze(
  Object.values(WORKSPACE_MODULES).filter((module) => module.roleConfigurable)
);

export const MODULE_ACCESS_LEVELS = Object.freeze(["lettura", "scrittura", "amministrazione"]);

const ACCESS_LEVEL_RANK = Object.freeze({ nessuno: 0, lettura: 1, scrittura: 2, amministrazione: 3 });

export function normalizeModuleAccessLevel(level, fallback = "lettura") {
  return Object.hasOwn(ACCESS_LEVEL_RANK, level) ? level : fallback;
}

export function moduleLevelAllows(actualLevel, requiredLevel = "lettura") {
  return ACCESS_LEVEL_RANK[normalizeModuleAccessLevel(actualLevel)] >= ACCESS_LEVEL_RANK[normalizeModuleAccessLevel(requiredLevel)];
}

export function moduleSelfServiceAllows(moduleCode, requiredLevel = "lettura") {
  const selfServiceLevel = WORKSPACE_MODULES[moduleCode]?.selfServiceLevel;
  return selfServiceLevel ? moduleLevelAllows(selfServiceLevel, requiredLevel) : false;
}

export function moduleIsAvailable(moduleCode, grantedModules = [], isAdmin = false) {
  const definition = WORKSPACE_MODULES[moduleCode];
  if (!definition) return isAdmin || grantedModules.includes(moduleCode);
  if (definition.alwaysAvailable) return true;
  if (isAdmin) return true;
  return grantedModules.includes(moduleCode);
}

export function featureIsAvailable(featureCode, grantedModules = [], isAdmin = false, visited = new Set()) {
  if (visited.has(featureCode)) return false;
  const definition = WORKSPACE_FEATURES[featureCode];
  if (!definition) return false;

  const nextVisited = new Set(visited).add(featureCode);
  if (definition.anyOf) {
    return definition.anyOf.some((dependency) =>
      featureIsAvailable(dependency, grantedModules, isAdmin, nextVisited)
    );
  }

  return (definition.requiresModules || []).every((moduleCode) =>
    moduleIsAvailable(moduleCode, grantedModules, isAdmin)
  );
}
