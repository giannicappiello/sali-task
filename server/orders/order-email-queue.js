function text(value) {
  return String(value ?? "").trim();
}

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
}) {
  const orderNumber = text(order?.numero_ordine_visualizzato) || text(order?.id);
  const attachments = documents.map((document) => ({
    tipo_documento: document.kind,
    numero: text(document.numero) || null,
    stato: "da_generare",
  }));
  const configSnapshot = {
    modulo_ordini: order?.modulo_ordini || "prof",
    invia_email_cliente: Boolean(moduleConfig?.invia_email_cliente),
    invia_email_agente: Boolean(moduleConfig?.invia_email_agente),
    invia_email_responsabile: Boolean(moduleConfig?.invia_email_responsabile),
    backoffice_1_email: normalizeOrderEmail(moduleConfig?.backoffice_1_email),
    backoffice_2_email: normalizeOrderEmail(moduleConfig?.backoffice_2_email),
  };

  return recipients.map((recipient) => ({
    ordine_id: order.id,
    evento: "mexal_sync_completed",
    tipo_destinatario: recipient.type,
    destinatario: recipient.email,
    stato: "queued",
    attempts: 0,
    max_attempts: 5,
    available_at: new Date().toISOString(),
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
  });
  if (!rows.length) return { recipients: 0, queued: 0 };

  const { data, error } = await supabase
    .from("ordini_email_invio")
    .upsert(rows, {
      onConflict: "ordine_id,evento,destinatario",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) throw error;
  return { recipients: recipients.length, queued: data?.length || 0 };
}
