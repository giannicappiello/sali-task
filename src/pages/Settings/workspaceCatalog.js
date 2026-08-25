export const normalizeWorkspaceSearch = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("it-IT")
  .trim();

export function matchesWorkspaceSearch(item, query, fields) {
  const normalizedQuery = normalizeWorkspaceSearch(query);
  if (!normalizedQuery) return true;
  return fields.some((field) => normalizeWorkspaceSearch(
    typeof field === "function" ? field(item) : item?.[field],
  ).includes(normalizedQuery));
}

export function matchesAssociationStatus(count, status) {
  if (status === "associated") return count > 0;
  if (status === "unassociated") return count === 0;
  return true;
}

export function selectedFirst(items, selectedCodes, getCode = (item) => item.codice) {
  const selected = new Set(selectedCodes);
  return [
    ...items.filter((item) => selected.has(getCode(item))),
    ...items.filter((item) => !selected.has(getCode(item))),
  ];
}

export function filterKeepingSelected(items, query, fields, selectedCodes = [], getCode = (item) => item.codice) {
  const selected = new Set(selectedCodes);
  return selectedFirst(
    items.filter((item) => selected.has(getCode(item)) || matchesWorkspaceSearch(item, query, fields)),
    selectedCodes,
    getCode,
  );
}

export function buildWorkspaceAssociations({ modules = [], screens = [], links = [], menus = [], menuModules = [], areas = [] }) {
  const moduleByCode = new Map(modules.map((item) => [item.codice, item]));
  const screenByCode = new Map(screens.map((item) => [item.codice, item]));
  const menuByCode = new Map(menus.map((item) => [item.codice, item]));
  const areaByCode = new Map(areas.map((item) => [item.codice, item]));
  const moduleLinks = new Map(modules.map((item) => [item.codice, []]));
  const screenLinks = new Map(screens.map((item) => [item.codice, []]));
  const moduleMenus = new Map(modules.map((item) => [item.codice, []]));
  const menuModuleLinks = new Map(menus.map((item) => [item.codice, []]));

  links.forEach((link) => {
    moduleLinks.get(link.modulo_codice)?.push({ ...link, screen: screenByCode.get(link.schermata_codice) });
    screenLinks.get(link.schermata_codice)?.push({ ...link, module: moduleByCode.get(link.modulo_codice) });
  });
  menuModules.forEach((link) => {
    moduleMenus.get(link.modulo_codice)?.push({ ...link, menu: menuByCode.get(link.voce_codice) });
    menuModuleLinks.get(link.voce_codice)?.push({ ...link, module: moduleByCode.get(link.modulo_codice) });
  });

  return { moduleByCode, screenByCode, menuByCode, areaByCode, moduleLinks, screenLinks, moduleMenus, menuModuleLinks };
}

export function associationSummary(items, limit = 3) {
  return { visible: items.slice(0, limit), remaining: Math.max(0, items.length - limit) };
}
