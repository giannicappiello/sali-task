import { crmTypeConfig } from "./crmConfig.js";

export function crmNavigation(type) {
  const { basePath } = crmTypeConfig(type);
  if (type === "conto_terzi") {
    return [
      ["Dashboard", basePath],
      ["Clienti", `${basePath}/clienti`],
      ["Progetti", `${basePath}/progetti`],
      ["Pipeline", `${basePath}/pipeline`],
      ["Attività", `${basePath}/attivita`],
      ["Campioni / Sviluppi", `${basePath}/sviluppi`],
      ["Analisi", `${basePath}/analisi`],
    ];
  }
  if (type === "b2b") {
    return [
      ["Dashboard", basePath],
      ["Clienti / Prospect", `${basePath}/clienti`],
      ["Pipeline acquisizione", `${basePath}/pipeline`],
      ["Attività", `${basePath}/attivita`],
      ["Clienti da seguire", `${basePath}/da-seguire`],
      ["Riordini", `${basePath}/riordini`],
      ["BeautyDays", `${basePath}/beautydays`],
      ["Analisi", `${basePath}/analisi`],
    ];
  }
  if (type === "brand_direct") {
    return [
      ["Dashboard", basePath],
      ["Progetti", `${basePath}/progetti`],
      ["Attività", `${basePath}/attivita`],
    ];
  }
  return [
    ["Dashboard", basePath],
    ["Clienti", `${basePath}/clienti`],
    ["Campagne", `${basePath}/campagne`],
    ["Creator", `${basePath}/creators`],
    ["Customer Journey", `${basePath}/journey`],
  ];
}
