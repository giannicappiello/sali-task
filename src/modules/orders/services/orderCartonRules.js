export const CARTON_RULE_TYPES = Object.freeze([
  { value: 'multiple_of', label: 'Multipli di' },
  { value: 'less_than', label: 'Quantità inferiore a' },
  { value: 'less_or_equal', label: 'Quantità non superiore a' },
  { value: 'greater_than', label: 'Quantità superiore a' },
  { value: 'greater_or_equal', label: 'Quantità non inferiore a' },
  { value: 'equal', label: 'Quantità pari a' },
]);
const code = value => String(value ?? '').trim().toUpperCase();
const numeric = value => Number(String(value ?? '').replace(',', '.'));
export function cartonRuleLabel(rule) {
  const type = CARTON_RULE_TYPES.find(item => item.value === rule.tipo);
  return (type?.label || 'Vincolo quantità') + ' ' + Number(rule.valore).toLocaleString('it-IT', { maximumFractionDigits: 6 });
}
export function normalizeCartonRule(rule, moduleCode) {
  const value = numeric(rule.valore);
  if (!['prof', 'ph'].includes(moduleCode)) throw new Error('Modulo cartonaggi non valido.');
  if (!CARTON_RULE_TYPES.some(item => item.value === rule.tipo)) throw new Error('Seleziona un tipo di limitazione.');
  if (!Number.isFinite(value) || value <= 0 || value > 1000000000 || Math.abs(value - Number(value.toFixed(6))) > 1e-9) throw new Error('Inserisci un valore maggiore di zero, con massimo 6 decimali.');
  const products = [...new Set((rule.prodotti || []).map(code).filter(Boolean))];
  if (!products.length) throw new Error('Seleziona almeno una referenza.');
  const message = String(rule.messaggio || '').trim();
  if (message.length > 500) throw new Error('Il messaggio può contenere al massimo 500 caratteri.');
  return { ...(rule.id ? { id: rule.id } : {}), modulo_ordini: moduleCode, tipo: rule.tipo, valore: value, prodotti: products, attiva: rule.attiva !== false, messaggio: message };
}
export function cartonQuantityAllowed(quantity, rule) {
  const q = numeric(quantity), v = numeric(rule.valore);
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(v) || v <= 0) return false;
  if (q >= 1e15 || v >= 1e15) return false;
  const units = number => BigInt(number.toFixed(6).replace('.', ''));
  const quantityUnits = units(q), valueUnits = units(v);
  if (valueUnits <= 0n) return false;
  switch (rule.tipo) {
    case 'multiple_of': return quantityUnits % valueUnits === 0n;
    case 'less_than': return quantityUnits < valueUnits;
    case 'less_or_equal': return quantityUnits <= valueUnits;
    case 'greater_than': return quantityUnits > valueUnits;
    case 'greater_or_equal': return quantityUnits >= valueUnits;
    case 'equal': return quantityUnits === valueUnits;
    default: return false;
  }
}
export function cartonRulesForProduct(rules, productCode, moduleCode) {
  if (!['prof', 'ph'].includes(moduleCode)) return [];
  return (rules || []).filter(rule => rule.attiva !== false && rule.modulo_ordini === moduleCode && (rule.prodotti || []).some(item => code(item) === code(productCode)));
}
export function validateOrderCartons(lines, rules, moduleCode) {
  const quantities = new Map();
  for (const line of lines || []) {
    if (line.riga_spedizione || line.riga_descrittiva || !code(line.codice_articolo)) continue;
    const product = code(line.codice_articolo);
    quantities.set(product, (quantities.get(product) || 0) + numeric(line.quantita));
  }
  const violations = [];
  for (const [productCode, quantity] of quantities) {
    for (const rule of cartonRulesForProduct(rules, productCode, moduleCode)) {
      if (cartonQuantityAllowed(quantity, rule)) continue;
      const message = [String(rule.messaggio || '').trim(), cartonRuleLabel(rule)].filter(Boolean).join(' · ');
      violations.push({ code: productCode, ruleId: rule.id, message: productCode + ': ' + message + '. Quantità inserita: ' + quantity + '.' });
    }
  }
  return violations;
}
