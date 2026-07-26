function text(value) {
  return String(value ?? "").trim();
}

export const ORDER_CONFIRMATION_EMAIL_EVENT = "order_confirmed";
export const MEXAL_EMAIL_GRACE_MS = 15 * 60 * 1000;

export function normalizeOrderEmail(value) {
  const email = text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function buildConfiguredOrderEmailRecipients({
  moduleConfig,
  customer,
  agent,
  responsible,
} = {}) {
  const candidates = [];
  if (moduleConfig?.invia_email_cliente) {
    candidates.push({ type: "cliente", email: customer?.email });
  }
  if (moduleConfig?.invia_email_agente) {
    candidates.push({ type: "agente", email: agent?.email });
  }
  if (moduleConfig?.invia_email_responsabile) {
    candidates.push({ type: "responsabile", email: responsible?.email });
  }
  candidates.push(
    { type: "backoffice_1", email: moduleConfig?.backoffice_1_email },
    { type: "backoffice_2", email: moduleConfig?.backoffice_2_email },
  );

  const recipients = new Map();
  for (const candidate of candidates) {
    const email = normalizeOrderEmail(candidate.email);
    if (email && !recipients.has(email)) recipients.set(email, { ...candidate, email });
  }
  return [...recipients.values()];
}

export function buildOrderEmailQueueRows({
  order,
  documents = [],
  recipients = [],
  moduleConfig,
  availableAt = new Date().toISOString(),
}) {
  const orderNumber = text(order?.numero_ordine_visualizzato) || text(order?.id);
  const attachments = documents.map((document) => ({
    tipo_documento: document.kind,
    numero: text(document.numero) || null,
    stato: "da_generare",
  }));
  const configSnapshot = {
    modulo_ordini: order?.modulo_ordini || "prof",
    invia_automaticamente_mexal: moduleConfig?.invia_automaticamente_mexal !== false,
    invia_email_cliente: Boolean(moduleConfig?.invia_email_cliente),
    invia_email_agente: Boolean(moduleConfig?.invia_email_agente),
    invia_email_responsabile: Boolean(moduleConfig?.invia_email_responsabile),
    backoffice_1_email: normalizeOrderEmail(moduleConfig?.backoffice_1_email),
    backoffice_2_email: normalizeOrderEmail(moduleConfig?.backoffice_2_email),
  };

  return recipients.map((recipient) => ({
    ordine_id: order.id,
    evento: ORDER_CONFIRMATION_EMAIL_EVENT,
    tipo_destinatario: recipient.type,
    destinatario: recipient.email,
    stato: "queued",
    attempts: 0,
    max_attempts: 5,
    available_at: availableAt,
    oggetto: `Conferma ordine ${orderNumber}`,
    allegati: attachments,
    config_snapshot: configSnapshot,
    last_error: null,
  }));
}

async function loadAgentRecipients(supabase, order, moduleConfig) {
  if (!moduleConfig?.invia_email_agente && !moduleConfig?.invia_email_responsabile) {
    return { agent: null, responsible: null };
  }
  const agentCode = text(order?.codice_agente_mexal);
  if (!agentCode) return { agent: null, responsible: null };

  const { data: agent, error: agentError } = await supabase
    .from("mexal_agenti")
    .select("email,responsabile_utente_id")
    .eq("codice", agentCode)
    .maybeSingle();
  if (agentError) throw agentError;

  if (!moduleConfig?.invia_email_responsabile || !agent?.responsabile_utente_id) {
    return { agent, responsible: null };
  }
  const { data: responsible, error: responsibleError } = await supabase
    .from("utenti")
    .select("email")
    .eq("id", agent.responsabile_utente_id)
    .maybeSingle();
  if (responsibleError) throw responsibleError;
  return { agent, responsible };
}

export async function enqueueOrderConfirmationEmails({
  supabase,
  order,
  customer,
  moduleConfig,
  documents,
  availableAt,
  releaseExisting = false,
}) {
  const { agent, responsible } = await loadAgentRecipients(supabase, order, moduleConfig);
  const recipients = buildConfiguredOrderEmailRecipients({
    moduleConfig,
    customer,
    agent,
    responsible,
  });
  const rows = buildOrderEmailQueueRows({
    order,
    documents,
    recipients,
    moduleConfig,
    availableAt,
  });
  if (!rows.length) return { recipients: 0, queued: 0, released: 0 };

  const { data, error } = await supabase
    .from("ordini_email_invio")
    .upsert(rows, {
      onConflict: "ordine_id,evento,destinatario",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) throw error;

  let released = 0;
  if (releaseExisting) {
    const { data: releasedRows, error: releaseError } = await supabase
      .from("ordini_email_invio")
      .update({
        available_at: new Date().toISOString(),
        allegati: rows[0].allegati,
        config_snapshot: rows[0].config_snapshot,
        last_error: null,
      })
      .eq("ordine_id", order.id)
      .eq("evento", ORDER_CONFIRMATION_EMAIL_EVENT)
      .in("destinatario", recipients.map(({ email }) => email))
      .in("stato", ["queued", "retry"])
      .select("id");
    if (releaseError) throw releaseError;
    released = releasedRows?.length || 0;
  }

  return { recipients: recipients.length, queued: data?.length || 0, released };
}

export async function loadOrderConfirmationEmailContext({
  supabase,
  orderId,
  moduleCode,
}) {
  let orderQuery = supabase.from("ordini_testate").select("*").eq("id", orderId);
  if (moduleCode) {
    orderQuery = moduleCode === "prof"
      ? orderQuery.or("modulo_ordini.eq.prof,modulo_ordini.is.null")
      : orderQuery.eq("modulo_ordini", moduleCode);
  }
  const { data: order, error: orderError } = await orderQuery.single();
  if (orderError) throw orderError;
  if (text(order?.stato).toLowerCase() !== "aperto") {
    throw Object.assign(new Error("L'ordine non risulta confermato."), { status: 409 });
  }

  const [
    { data: customer, error: customerError },
    { data: moduleConfig, error: moduleConfigError },
    { data: documents, error: documentsError },
  ] = await Promise.all([
    supabase
      .from("ordini_clienti_cache")
      .select("*")
      .eq("codice_cliente", order.codice_cliente)
      .maybeSingle(),
    supabase
      .from("ordini_moduli_configurazione")
      .select("invia_automaticamente_mexal,invia_email_agente,invia_email_cliente,invia_email_responsabile,backoffice_1_email,backoffice_2_email")
      .eq("modulo_ordini", order.modulo_ordini || moduleCode || "prof")
      .maybeSingle(),
    supabase
      .from("ordini_documenti_mexal")
      .select("tipo_documento,numero")
      .eq("ordine_id", orderId)
      .not("numero", "is", null),
  ]);
  if (customerError || moduleConfigError || documentsError) {
    throw customerError || moduleConfigError || documentsError;
  }

  return {
    order,
    customer,
    moduleConfig,
    documents: (documents || []).map((document) => ({
      kind: document.tipo_documento,
      numero: document.numero,
    })),
  };
}

export function confirmationEmailAvailableAt(moduleConfig, now = Date.now()) {
  return new Date(
    moduleConfig?.invia_automaticamente_mexal === false
      ? now
      : now + MEXAL_EMAIL_GRACE_MS,
  ).toISOString();
}
