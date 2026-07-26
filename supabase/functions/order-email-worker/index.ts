import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSmtpClient } from "../../../server/email/smtp-client.js";
import {
  ORDER_EMAIL_LEASE_SECONDS,
  processNextOrderEmailJob,
} from "../../../server/orders/order-email-job.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};
Deno.serve(async (request: Request) => {
  try {
    if (request.method !== "POST") return json({ error: "Metodo non consentito" }, 405);

    const expectedSecret = requireEnv("WORKER_SECRET");
    const suppliedSecret = request.headers.get("x-order-email-worker-secret") || "";
    if (!timingSafeEqual(suppliedSecret.trim(), expectedSecret.trim())) {
      console.error(JSON.stringify({ event: "order_email_worker_auth_failed" }));
      return json({ error: "Worker email non autorizzato" }, 401);
    }

    const smtp = createSmtpClient();
    const workerId = `order-email-worker:${crypto.randomUUID()}`;
    const supabase = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const result = await processNextOrderEmailJob({
      supabase,
      smtp,
      workerId,
      leaseSeconds: ORDER_EMAIL_LEASE_SECONDS,
    });
    if (result.status === "error") return json({ error: result.error }, 500);
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      event: "order_email_worker_fatal_error",
      emailId: null,
      error: message,
    }));
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}
