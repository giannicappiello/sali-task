function selectedIds(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

export function buildMultiOctProductionSelection({ orderIds = [], lineIds = [], snapshotId = null } = {}) {
  const orders = selectedIds(orderIds);
  const lines = selectedIds(lineIds);
  if (!orders.length && !lines.length) throw new Error("Selezionare almeno un OCT.");
  return {
    action: "progremes_production_request",
    orderIds: orders,
    lineIds: lines,
    snapshotId,
  };
}

export function createProductionRequestSubmitter(call) {
  if (typeof call !== "function") throw new TypeError("Client RdP obbligatorio.");
  let pending = null;
  return async function submit(selection) {
    if (pending) return pending;
    const payload = buildMultiOctProductionSelection(selection);
    pending = Promise.resolve().then(() => call(payload));
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
}
