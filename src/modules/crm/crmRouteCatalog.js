export const CRM_ROUTE_CATALOG = Object.freeze([
  { index: true, path: "", catalogPath: "/crm", moduleCode: "crm", screenCode: "crm.dashboard", view: "overview" },
  { path: "direct", catalogPath: "/crm/direct", moduleCode: "crm_direct", screenCode: "crm.direct.dashboard", view: "direct-overview" },
  { path: "brand-direct", catalogPath: "/crm/brand-direct", moduleCode: "crm_brand_direct", screenCode: "crm.brand_direct.dashboard", view: "brand-direct-dashboard", type: "brand_direct" },
  { path: "brand-direct/progetti", catalogPath: "/crm/brand-direct/progetti", moduleCode: "crm_brand_direct", screenCode: "crm.brand_direct.progetti", view: "projects", type: "brand_direct" },
  { path: "brand-direct/attivita", catalogPath: "/crm/brand-direct/attivita", moduleCode: "crm_brand_direct", screenCode: "crm.brand_direct.attivita", view: "activities", type: "brand_direct" },
  { path: "conto-terzi", catalogPath: "/crm/conto-terzi", moduleCode: "crm_conto_terzi", screenCode: "crm.conto_terzi.dashboard", view: "dashboard", type: "conto_terzi" },
  { path: "conto-terzi/clienti", catalogPath: "/crm/conto-terzi/clienti", moduleCode: "crm_conto_terzi", screenCode: "crm.conto_terzi.clienti", view: "accounts", type: "conto_terzi" },
  { path: "conto-terzi/clienti/:id", catalogPath: "/crm/conto-terzi/clienti/:id", moduleCode: "crm_conto_terzi", screenCode: "crm.conto_terzi.cliente", view: "account", type: "conto_terzi" },
  { path: "conto-terzi/pipeline", catalogPath: "/crm/conto-terzi/pipeline", moduleCode: "crm_conto_terzi", screenCode: "crm.conto_terzi.pipeline", view: "pipeline", type: "conto_terzi" },
  { path: "conto-terzi/opportunita", catalogPath: "/crm/conto-terzi/opportunita", moduleCode: "crm_conto_terzi", screenCode: "crm.conto_terzi.opportunita", view: "projects", type: "conto_terzi" },
  { path: "conto-terzi/pipeline/:opportunityId", catalogPath: "/crm/conto-terzi/pipeline/:opportunityId", moduleCode: "crm_conto_terzi", screenCode: "crm.conto_terzi.pipeline", view: "opportunity", type: "conto_terzi" },
  { path: "conto-terzi/attivita", catalogPath: "/crm/conto-terzi/attivita", moduleCode: "crm_conto_terzi", screenCode: "crm.conto_terzi.attivita", view: "activities", type: "conto_terzi" },
  { path: "conto-terzi/analisi", catalogPath: "/crm/conto-terzi/analisi", moduleCode: "crm_conto_terzi", screenCode: "crm.conto_terzi.analisi", view: "analytics", type: "conto_terzi" },
  { path: "conto-terzi/sviluppi", catalogPath: "/crm/conto-terzi/sviluppi", moduleCode: "crm_conto_terzi", screenCode: "crm.conto_terzi.sviluppi", view: "developments", type: "conto_terzi" },
  { path: "conto-terzi/progetti", catalogPath: "/crm/conto-terzi/progetti", moduleCode: "crm_conto_terzi", screenCode: "crm.conto_terzi.progetti", view: "projects", type: "conto_terzi" },
  { path: "conto-terzi/brief", catalogPath: "/crm/conto-terzi/brief", moduleCode: "crm_conto_terzi", screenCode: "crm.conto_terzi.brief", view: "briefs" },
  { path: "b2b", catalogPath: "/crm/b2b", moduleCode: "crm_b2b", screenCode: "crm.b2b.dashboard", view: "dashboard", type: "b2b" },
  { path: "b2b/clienti", catalogPath: "/crm/b2b/clienti", moduleCode: "crm_b2b", screenCode: "crm.b2b.clienti", view: "accounts", type: "b2b" },
  { path: "b2b/clienti/:id", catalogPath: "/crm/b2b/clienti/:id", moduleCode: "crm_b2b", screenCode: "crm.b2b.cliente", view: "account", type: "b2b" },
  { path: "b2b/pipeline", catalogPath: "/crm/b2b/pipeline", moduleCode: "crm_b2b", screenCode: "crm.b2b.pipeline", view: "pipeline", type: "b2b" },
  { path: "b2b/pipeline/:opportunityId", catalogPath: "/crm/b2b/pipeline/:opportunityId", moduleCode: "crm_b2b", screenCode: "crm.b2b.pipeline", view: "opportunity", type: "b2b" },
  { path: "b2b/attivita", catalogPath: "/crm/b2b/attivita", moduleCode: "crm_b2b", screenCode: "crm.b2b.attivita", view: "activities", type: "b2b" },
  { path: "b2b/analisi", catalogPath: "/crm/b2b/analisi", moduleCode: "crm_b2b", screenCode: "crm.b2b.analisi", view: "analytics", type: "b2b" },
  { path: "b2b/da-seguire", catalogPath: "/crm/b2b/da-seguire", moduleCode: "crm_b2b", screenCode: "crm.b2b.da_seguire", view: "follow-up", type: "b2b" },
  { path: "b2b/riordini", catalogPath: "/crm/b2b/riordini", moduleCode: "crm_b2b", screenCode: "crm.b2b.riordini", view: "reorders", type: "b2b" },
  { path: "b2b/beautydays", catalogPath: "/crm/b2b/beautydays", moduleCode: "crm_b2b", screenCode: "crm.b2b.beautydays", view: "beautydays", type: "b2b" },
  { path: "online", catalogPath: "/crm/online", moduleCode: "crm_online", screenCode: "crm.online.dashboard", view: "online-home" },
  { path: "online/digital", catalogPath: "/crm/online/digital", moduleCode: "crm_online", screenCode: "crm.online.digital", view: "digital-dashboard" },
  { path: "online/ecommerce", catalogPath: "/crm/online/ecommerce", moduleCode: "crm_online_ecommerce", screenCode: "crm.online.ecommerce", view: "digital-channel", channel: "ecommerce" },
  { path: "online/mailing", catalogPath: "/crm/online/mailing", moduleCode: "crm_online_mailing", screenCode: "crm.online.mailing", view: "digital-channel", channel: "mailing" },
  { path: "online/amazon", catalogPath: "/crm/online/amazon", moduleCode: "crm_online_amazon", screenCode: "crm.online.amazon", view: "digital-channel", channel: "amazon" },
  { path: "online/adv", catalogPath: "/crm/online/adv", moduleCode: "crm_online_adv", screenCode: "crm.online.adv", view: "digital-channel", channel: "adv" },
  { path: "online/clienti", catalogPath: "/crm/online/clienti", moduleCode: "crm_online", screenCode: "crm.online.clienti", view: "accounts", type: "online" },
  { path: "online/clienti/:id", catalogPath: "/crm/online/clienti/:id", moduleCode: "crm_online", screenCode: "crm.online.cliente", view: "account", type: "online" },
  { path: "online/campagne", catalogPath: "/crm/online/campagne", moduleCode: "crm_online", screenCode: "crm.online.campaigns", view: "online-manager", entity: "campaigns" },
  { path: "online/creators", catalogPath: "/crm/online/creators", moduleCode: "crm_online", screenCode: "crm.online.creators_v2", view: "online-manager", entity: "creators" },
  { path: "online/journey", catalogPath: "/crm/online/journey", moduleCode: "crm_online", screenCode: "crm.online.journey_v2", view: "digital-journey" },
  { path: "online/analytics", catalogPath: "/crm/online/analytics", moduleCode: "crm_online", screenCode: "crm.online.analytics", view: "digital-analytics" },
  { path: "online/ai", catalogPath: "/crm/online/ai", moduleCode: "crm_ai", screenCode: "crm.online.ai", view: "ai" },
  { path: "ai", catalogPath: "/crm/ai", moduleCode: "crm_ai", screenCode: "crm.ai", view: "ai" },
]);

export const CRM_ROUTE_ALIASES = Object.freeze([
  { path: "online/creator", to: "/crm/online/creators" },
  { path: "online/customer-journey", to: "/crm/online/journey" },
]);

export function selectAuthorizedCrmModules(dependencies, modules, hasModuleAccess) {
  const modulesByCode = new Map(modules.map((module) => [module.codice, module]));
  return dependencies
    .map((code) => modulesByCode.get(code))
    .filter((module) => module?.percorso && hasModuleAccess(module.codice));
}
