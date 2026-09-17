const alphabet = new Intl.Collator('it', { sensitivity: 'base', numeric: true });
export const comparePeople = (a, b) => alphabet.compare(a.name || '', b.name || '') || String(a.user_id || a.id || '').localeCompare(String(b.user_id || b.id || ''));

// Normalize once so selectors, cards, calendars and tables share the same order.
export function sortHrPeople(data) {
  const employees = [...(data.employees || [])].sort(comparePeople);
  const users = [...(data.users || [])].sort(comparePeople);
  const names = new Map([...users.map(u => [u.id, u.name]), ...employees.map(e => [e.user_id, e.name])]);
  const byEmployee = (a, b) => alphabet.compare(names.get(a.user_id) || '', names.get(b.user_id) || '');
  return { ...data, employees, users,
    attendance: [...(data.attendance || [])].sort(byEmployee),
    shifts: [...(data.shifts || [])].sort(byEmployee),
    requests: [...(data.requests || [])].sort(byEmployee),
    recipients: [...(data.recipients || [])].sort((a, b) => alphabet.compare(names.get(a) || '', names.get(b) || '')),
  };
}
