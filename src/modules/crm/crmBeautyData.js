export function postEventOrders(events) {
  return [...new Map(events.filter(event => event.stato === "eseguita")
    .flatMap(event => event.impact?.orders || []).map(order => [order.id, order])).values()];
}
export function postEventOrderValue(events) {
  return postEventOrders(events).reduce((sum, order) => sum + Math.round(Number(order.value || 0) * 100), 0) / 100;
}
export function beautyDetailEvents(events, metric) {
  if (metric === "planned") return events.filter(event => event.stato === "pianificata");
  if (metric !== "customers") return events.filter(event => event.stato === "eseguita");
  const groups = new Map();
  for (const event of events) groups.set(event.customer_code, [...(groups.get(event.customer_code) || []), event]);
  return [...groups.values()].map(group => {
    const sorted = [...group].sort((a,b) => b.data.localeCompare(a.data));
    const executed = sorted.filter(event => event.stato === "eseguita");
    const latest = sorted[0];
    return { ...latest, id: "customer-" + latest.customer_code,
      first_event_date: sorted.at(-1).data, event_count: group.length,
      stato: group.length > 1 ? group.length + " giornate" : latest.stato,
      numero_totale_pezzi_venduti: executed.reduce((sum,event) => sum + Number(event.numero_totale_pezzi_venduti || 0),0),
      fatturato_giornata: executed.reduce((sum,event) => sum + Number(event.fatturato_giornata || 0),0),
      impact: { ...latest.impact, order_value: postEventOrderValue(group) },
    };
  });
}
