import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSmtpClient, isPermanentSmtpError } from "../../../server/email/smtp-client.js";
import { loadOrderPdfEmailData } from "../../../server/orders/order-pdf-server.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};
const LEASE_SECONDS = 300;

Deno.serve(async (request: Request) => {
  let claimedEmail: Record<string, any> | null = null;
  let workerId = "";
  let lockToken = "";
  let supabase: ReturnType<typeof createClient> | null = null;

  try {
    if (request.method !== "POST") return json({ error: "Metodo non consentito" }, 405);

    const expectedSecret = requireEnv("WORKER_SECRET");
    const suppliedSecret = request.headers.get("x-order-email-worker-secret") || "";
    if (!timingSafeEqual(suppliedSecret.trim(), expectedSecret.trim())) {
      console.error(JSON.stringify({ event: "order_email_worker_auth_failed" }));
      return json({ error: "Worker email non autorizzato" }, 401);
    }

    const smtp = createSmtpClient();
    workerId = `order-email-worker:${crypto.randomUUID()}`;
    supabase = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_next_order_email",
      {
        p_worker_id: workerId,
        p_lease_seconds: LEASE_SECONDS,
      },
    );
    if (claimError) throw new Error(`claim_next_order_email: ${claimError.message}`);

    claimedEmail = Array.isArray(claimed) ? claimed[0] ?? null : claimed ?? null;
    if (!claimedEmail) {
      console.log(JSON.stringify({ event: "order_email_worker_idle", workerId }));
      return json({ status: "idle", workerId });
    }

    lockToken = String(claimedEmail.lock_token || "");
    if (!lockToken) throw new Error("lock_token email mancante");

    console.log(JSON.stringify({
      event: "order_email_claimed",
      workerId,
      emailId: claimedEmail.id,
      orderId: claimedEmail.ordine_id,
      recipientType: claimedEmail.tipo_destinatario,
    }));

    const { order, attachments } = await loadOrderPdfEmailData({
      supabase,
      orderId: claimedEmail.ordine_id,
    });
    const orderReference = String(
      order.numero_ordine_visualizzato || order.numero_ordine || order.id,
    );
    const result = await smtp.send({
      to: claimedEmail.destinatario,
      subject: claimedEmail.oggetto,
      text: `In allegato trovi la conferma dell'ordine ${orderReference}.`,
      html: `<p>In allegato trovi la conferma dell'ordine <strong>${escapeHtml(orderReference)}</strong>.</p>`,
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

    console.log(JSON.stringify({
      event: "order_email_sent",
      emailId: claimedEmail.id,
      orderId: claimedEmail.ordine_id,
      provider: result.provider,
      messageId: result.messageId,
      attachments: attachments.length,
    }));
    return json({
      status: "sent",
      emailId: claimedEmail.id,
      messageId: result.messageId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      event: claimedEmail ? "order_email_failed" : "order_email_worker_fatal_error",
      emailId: claimedEmail?.id ?? null,
      error: message,
    }));

    if (supabase && claimedEmail?.id && workerId && lockToken) {
      const { error: retryError } = await supabase.rpc("retry_order_email", {
        p_email_id: claimedEmail.id,
        p_worker_id: workerId,
        p_lock_token: lockToken,
        p_error: message,
        p_permanent: isPermanentSmtpError(error),
      });
      if (retryError) {
        console.error(JSON.stringify({
          event: "order_email_retry_update_failed",
          emailId: claimedEmail.id,
          error: retryError.message,
        }));
      }
    }
    return json({ error: message }, 500);
  }
});

function requireEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Secret mancante: ${name}`);
  return value;
}

function timingSafeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}
