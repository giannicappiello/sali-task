export const MEXAL_AUTOMATIONS = Object.freeze([
  { key: "sync_clients", label: "Sincronizza Clienti", actionType: "clients", automationType: "scheduled", supported: true },
  { key: "sync_products", label: "Sincronizza Prodotti", actionType: "products", automationType: "scheduled", supported: true },
  { key: "sync_stocks", label: "Sincronizza Giacenze", actionType: "stocks", automationType: "scheduled", supported: true },
  { key: "sync_conditions", label: "Sincronizza Modalità di pagamento", actionType: "commercial_conditions", automationType: "scheduled", supported: true },
  { key: "sync_series", label: "Sincronizza Serie documenti", actionType: "document_series", automationType: "scheduled", supported: true },
  { key: "sync_all", label: "Sincronizza tutto", actionType: "sync_all", automationType: "scheduled", supported: true },
  { key: "sync_agents", label: "Sincronizza Agenti", automationType: "scheduled", supported: false, reason: "Endpoint Mexal Agenti non configurato." },
  { key: "availability", label: "Aggiornamento disponibilità prodotti", automationType: "scheduled", supported: false, reason: "Automazione non configurata." },
  ...["order_created", "order_approved", "order_sent", "order_send_failed", "sync_completed", "sync_failed", "stock_updated"].map((key) => ({ key, label: key.replaceAll("_", " "), automationType: "event", supported: false, reason: "Evento applicativo non ancora collegato." })),
]);
