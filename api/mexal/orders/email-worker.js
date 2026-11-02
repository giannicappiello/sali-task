import { randomUUID, timingSafeEqual } from "node:crypto";
import {Buffer} from 'node:buffer';
import process from 'node:process';
import { createClient } from "@supabase/supabase-js";
import { loadOrderPdfEmailData } from "../../../server/orders/order-pdf-server.js";
import { claimShipmentEmail, updateShipmentEmail } from '../../../server/shipment-email-worker.js';

const LEASE_SECONDS = 300;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

function authorized(req) {
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const expected = String(
    process.env.ARUBA_EMAIL_WORKER_SECRET || process.env.WORKER_SECRET || "",
  ).trim();
  if (!expected) throw new Error("Variabile Vercel mancante: ARUBA_EMAIL_WORKER_SECRET");
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function adminClient() {
  return createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function workerId(req) {
  const source = String(req.headers["x-worker-source"] || "aruba").replace(/[^a-z0-9_.:-]/gi, "").slice(0, 80);
  return `order-email-${source || "aruba"}:${randomUUID()}`;
}

function attachmentPayload(attachment) {
  return {
    filename: attachment.filename,
    content_type: attachment.contentType || "application/pdf",
    base64: Buffer.from(attachment.content).toString("base64"),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });

  try {
    if (!authorized(req)) return res.status(401).json({ error: "Worker non autorizzato." });
    const supabase = adminClient();
    const action = String(req.body?.action || "").trim().toLowerCase();

    if (action === "claim") {
      const id = workerId(req);
      // Old Aruba workers must not acquire DDT jobs until they support the
      // durable before-send marker. Existing order mail stays compatible.
      if (req.body?.shipment_protocol === 1) {
        const shipment = await claimShipmentEmail(supabase,id);
        if (shipment) return res.status(200).json({status:'claimed',worker_id:id,email:{id:'ddt:'+shipment.job.id,
          lock_token:shipment.job.lock_token,destinatario:shipment.job.recipient,oggetto:shipment.job.subject,corpo:shipment.job.body},
          attachments:shipment.attachments.map(attachmentPayload)});
      }
      const { data, error } = await supabase.rpc("claim_next_order_email", {
        p_worker_id: id,
        p_lease_seconds: LEASE_SECONDS,
      });
      if (error) throw new Error(`claim_next_order_email: ${error.message}`);
      const email = Array.isArray(data) ? data[0] || null : data || null;
      if (!email) return res.status(200).json({ status: "idle" });

      try {
        const { order, attachments } = await loadOrderPdfEmailData({
          supabase,
          orderId: email.ordine_id,
        });
        return res.status(200).json({
          status: "claimed",
          worker_id: id,
          email: {
            id: email.id,
            lock_token: email.lock_token,
            ordine_id: email.ordine_id,
            destinatario: email.destinatario,
            tipo_destinatario: email.tipo_destinatario,
            oggetto: email.oggetto,
            corpo: String(email.corpo || "").trim()
              || `In allegato trovi la conferma dell'ordine ${order.numero_ordine_visualizzato || order.numero_ordine || order.id}.`,
          },
          attachments: attachments.map(attachmentPayload),
        });
      } catch (error) {
        await supabase.rpc("retry_order_email", {
          p_email_id: email.id,
          p_worker_id: id,
          p_lock_token: email.lock_token,
          p_error: error.message || "Generazione allegati non riuscita.",
          p_permanent: false,
        });
        throw error;
      }
    }

    if (String(req.body?.email_id || '').startsWith('ddt:') && ['sending','complete','retry'].includes(action)) {
      const id = String(req.body.email_id).slice(4);
      if (!/^[a-f0-9-]{36}$/i.test(id)) return res.status(400).json({error:'Invio DDT non valido.'});
      await updateShipmentEmail(supabase,{id,lock_token:req.body.lock_token},req.body.worker_id,action,
        action === 'complete' ? String(req.body.message_id || '') : String(req.body.error || ''),req.body.definitive === true);
      return res.status(200).json({status:action});
    }
    if (action === "complete") {
      const { error } = await supabase.rpc("complete_order_email", {
        p_email_id: req.body?.email_id,
        p_worker_id: req.body?.worker_id,
        p_lock_token: req.body?.lock_token,
        p_provider: "aruba_php_mail",
        p_provider_message_id: String(req.body?.message_id || "").trim() || null,
      });
      if (error) throw new Error(`complete_order_email: ${error.message}`);
      return res.status(200).json({ status: "completed" });
    }

    if (action === "retry") {
      const { error } = await supabase.rpc("retry_order_email", {
        p_email_id: req.body?.email_id,
        p_worker_id: req.body?.worker_id,
        p_lock_token: req.body?.lock_token,
        p_error: String(req.body?.error || "Invio Aruba non riuscito").slice(0, 4000),
        p_permanent: req.body?.permanent === true,
      });
      if (error) throw new Error(`retry_order_email: ${error.message}`);
      return res.status(200).json({ status: "retry_registered" });
    }

    return res.status(400).json({ error: "Azione non riconosciuta." });
  } catch (error) {
    console.error("Aruba order email worker API error", {
      error: error.message,
      action: req.body?.action || null,
    });
    return res.status(500).json({ error: error.message || "Errore worker email." });
  }
}
