const text = value => String(value ?? "").trim();
const normalize = value => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Resolve names only by the exact customer code, never by a similar name.
export function withCustomerNames(evidence, customers) {
 const nameFor = (code, fallback) => text(customers.get(text(code))) || text(fallback) || text(code);
 return {...evidence,
  customerName: nameFor(evidence.customerCode, evidence.customerName),
  links: (evidence.links || []).map(link => ({...link, customerName: nameFor(link.customerCode, link.customerName)})),
 };
}

export function matchesProductionSearch(record, query) {
 const fields = [record.orderNumber, record.customerName, record.customerCode,
  record.articleCode, record.articleName, record.lot, record.bulkLot, record.state,
  ...(record.links || []).flatMap(link => [link.oct, link.customerName, link.customerCode]),
  ...(record.phases || []).flatMap(phase => [phase.phase, phase.machine?.code, phase.machine?.department,
   ...(phase.personnel || []).flatMap(person => [person.name, person.department])])];
 const haystack = normalize(fields.join(" "));
 return normalize(query).split(/\s+/).every(term => haystack.includes(term));
}
