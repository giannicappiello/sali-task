export function categoryLabel(category, categories) {
  const names = [], seen = new Set();let current = category;
  while (current && !seen.has(current.id)) { names.unshift(current.name);seen.add(current.id);current = categories.find(row => row.id === current.parent_id); }
  return names.join(' / ');
}
