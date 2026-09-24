import { agreementForDay, separateOvertime } from './hrAgreements.js';
import { comparePeople } from './hrPeople.js';
import { monthDays, romeInstant } from './hrTime.js';

// Calculate each day with its effective agreement, then group by employee.
// Splitting also prevents an overnight/month-boundary request being counted twice.
export function overtimeSummary(data, month) {
  const days = monthDays(month);
  const grouped = new Map(), seen = new Set();
  const employees = new Map((data.employees || []).map(e => [e.user_id, e]));
  for (const request of data.requests || []) {
    if (request.kind !== 'overtime' || request.status !== 'approved') continue;
    if (request.id && seen.has(request.id)) continue;
    if (request.id) seen.add(request.id);
    const from = Date.parse(request.starts_at), to = Date.parse(request.ends_at);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    for (const day of days) {
      const next = new Date(`${day}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const start = Date.parse(romeInstant(`${day}T00:00`));
      const end = Date.parse(romeInstant(`${next.toISOString().slice(0, 10)}T00:00`));
      const hours = Math.max(0, Math.min(to, end) - Math.max(from, start)) / 3600000;
      if (!hours) continue;
      if (!grouped.has(request.user_id)) grouped.set(request.user_id, {
        user_id: request.user_id, name: employees.get(request.user_id)?.name || 'Dipendente',
        hours: 0, amount: 0, missing: false, management: new Set(),
      });
      const row = grouped.get(request.user_id);
      const contract = agreementForDay(data.contracts, request.user_id, day);
      row.hours += hours;
      row.management.add(!contract ? 'Accordo mancante' : separateOvertime(contract) ? 'Separata' : 'Ordinaria');
      const rate = contract?.overtime_rate, percent = contract?.overtime_percent;
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 ||
          typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0) row.missing = true;
      else row.amount += hours * rate * (1 + percent / 100);
    }
  }
  return [...grouped.values()].sort(comparePeople).map(row => ({ ...row,
    amount: row.missing ? null : Math.round((row.amount + Number.EPSILON) * 100) / 100,
    management: [...row.management].join(' / '),
  }));
}
