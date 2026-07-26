import { isPermanentSmtpError } from "../email/smtp-client.js";
import { loadOrderPdfEmailData } from "./order-pdf-server.js";

export const ORDER_EMAIL_LEASE_SECONDS = 300;

function log(logger, level, payload) {
  const target = logger?.[level] || console[level];
  target.call(logger || console, JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailBody(claimedEmail, orderReference) {
  return String(claimedEmail?.corpo || "").trim()
    || `In allegato trovi la conferma dell'ordine ${orderReference}.`;
}

function emailBodyHtml(body) {
  return `<p>${escapeHtml(body).replace(/\r?\n/g, "<br>")}</p>`;
}

export async function processNextOrderEmailJob({
  supabase,
  smtp,
  workerId,
  leaseSeconds = ORDER_EMAIL_LEASE_SECONDS,
  logger = console,
  loadEmailData = loadOrderPdfEmailData,
  isPermanentError = isPermanentSmtpError,
}) {
  let claimedEmail = null;
  let lockToken = "";

  try {
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_next_order_email",
      {
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
      },
    );
    if (claimError) throw new Error(`claim_next_order_email: ${claimError.message}`);

    claimedEmail = Array.isArray(claimed) ? claimed[0] ?? null : claimed ?? null;
    if (!claimedEmail) {
      log(logger, "log", { event: "order_email_worker_idle", workerId });
      return { status: "idle", workerId };
    }

    lockToken = String(claimedEmail.lock_token || "");
    if (!lockToken) throw new Error("lock_token email mancante");

    log(logger, "log", {
      event: "order_email_claimed",
      workerId,
      emailId: claimedEmail.id,
      orderId: claimedEmail.ordine_id,
      recipientType: claimedEmail.tipo_destinatario,
    });

    const { order, attachments } = await loadEmailData({
      supabase,
      orderId: claimedEmail.ordine_id,
    });
    const orderReference = String(
      order.numero_ordine_visualizzato || order.numero_ordine || order.id,
    );
    const body = emailBody(claimedEmail, orderReference);
    const result = await smtp.send({
      to: claimedEmail.destinatario,
      subject: claimedEmail.oggetto,
      text: body,
      html: emailBodyHtml(body),
      attachments,
    });

    const { error: completeError } = await supabase.rpc("complete_order_email", {
      p_email_id: claimedEmail.id,
      p_worker_id: workerId,
      p_lock_token: lockToken,
      p_provider: result.provider,
      p_provider_message_id: result.messageId,
    });
    if (completeError) throw new Error(`complete_order_email: ${completeError.message}`);

    log(logger, "log", {
      event: "order_email_sent",
      emailId: claimedEmail.id,
      orderId: claimedEmail.ordine_id,
      provider: result.provider,
      messageId: result.messageId,
      attachments: attachments.length,
    });
    return {
      status: "sent",
      emailId: claimedEmail.id,
      messageId: result.messageId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(logger, "error", {
      event: claimedEmail ? "order_email_failed" : "order_email_worker_fatal_error",
      emailId: claimedEmail?.id ?? null,
      error: message,
    });

    if (claimedEmail?.id && workerId && lockToken) {
      const { error: retryError } = await supabase.rpc("retry_order_email", {
        p_email_id: claimedEmail.id,
        p_worker_id: workerId,
        p_lock_token: lockToken,
        p_error: message,
        p_permanent: isPermanentError(error),
      });
      if (retryError) {
        log(logger, "error", {
          event: "order_email_retry_update_failed",
          emailId: claimedEmail.id,
          error: retryError.message,
        });
      }
    }
    return { status: "error", error: message };
  }
}
