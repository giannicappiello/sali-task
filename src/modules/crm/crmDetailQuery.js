export function queryDetailRows(rows, columns, search, filters, sort) {
  const text = value => String(value ?? '').toLocaleLowerCase('it-IT');
  const selected = rows.filter(row => (!search || columns.some(c => text(c.value(row)).includes(text(search)))) && columns.every(c => !filters[c.key] || text(c.value(row)).includes(text(filters[c.key]))));
  const column = columns.find(c => c.key === sort.key);
  if (!column) return selected;
  return [...selected].sort((a, b) => {
    const left = (column.sortValue || column.value)(a); const right = (column.sortValue || column.value)(b);
    const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left ?? '').localeCompare(String(right ?? ''), 'it-IT', { numeric: true });
    return sort.direction === 'desc' ? -result : result;
  });
}

