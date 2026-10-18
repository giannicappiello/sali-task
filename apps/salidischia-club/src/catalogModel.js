export function categoryPath(category, categories) {
  const labels = [], seen = new Set();
  let current = category;
  while (current && !seen.has(current.id)) { seen.add(current.id); labels.unshift(current.name); current = categories.find(item => item.id === current.parent_id); }
  return labels.join(' / ');
}
export function safeWebsiteUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}
export const contentLabels = { news: 'Novità', offer: 'Offerta', communication: 'Comunicazione' };
