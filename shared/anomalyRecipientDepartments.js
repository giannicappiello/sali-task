const excludedDepartments = new Set([
 'beauty consultant',
 'cliente private',
 'field force estero',
 'field force farmacia',
 'field force professional',
]);

export function allowsAnomalyDepartmentManager(department) {
 const name = String(department?.nome || '').trim().toLowerCase().replace(/\s+/g, ' ');
 return !excludedDepartments.has(name);
}
