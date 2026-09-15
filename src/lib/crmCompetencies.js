export const CRM_COMPETENCIES = [
  { value: 'brand_direct', label: 'BRAND DIRECT' },
  { value: 'conto_terzi', label: 'PRIVATE' },
  { value: 'b2b', label: 'B2B' },
  { value: 'online', label: 'B2C' },
];

export function matchesCrmCompetency(item, crmType) {
  if (!crmType) return true;
  return Array.isArray(item?.competenze_crm) && item.competenze_crm.includes(crmType);
}

export function crmTypeFromPath(path = '') {
  const section = path.match(/^\/crm\/(brand-direct|conto-terzi|b2b|online)(?:\/|\?|$)/)?.[1];
  return ({ 'brand-direct': 'brand_direct', 'conto-terzi': 'conto_terzi', b2b: 'b2b', online: 'online' })[section] || '';
}

export function projectRulesForCrm(rules, templates, projectTypeId, crmType) {
  const allowed = new Set(templates.filter((item) => item.attivo !== false && matchesCrmCompetency(item, crmType)).map((item) => item.id));
  return rules.filter((rule) => rule.tipo_progetto_id === projectTypeId && allowed.has(rule.template_id))
    .sort((a, b) => Number(a.ordine || 0) - Number(b.ordine || 0));
}

// Follow an explicit dependency through excluded phases to its closest included ancestor.
export function resolveRuleBlocker(rule, allRules, createdByRule, previousPhaseId) {
  if (!rule.dipende_da_id) return previousPhaseId;
  let id = rule.dipende_da_id;
  const visited = new Set();
  while (id && !visited.has(id)) {
    if (createdByRule.has(id)) return createdByRule.get(id);
    visited.add(id);
    id = allRules.find((item) => item.id === id)?.dipende_da_id;
  }
  return null;
}
