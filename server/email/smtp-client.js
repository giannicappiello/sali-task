import nodemailer from "nodemailer";
import { normalizeEmailRecipients } from "./email-recipients.js";

function runtimeEnv(name) {
  if (globalThis.Deno?.env?.get) return globalThis.Deno.env.get(name);
  return globalThis.process?.env?.[name];
}

function required(getEnv, name) {
  const value = String(getEnv(name) ?? "").trim();
  if (!value) {
    const error = new Error(`Configurazione SMTP mancante: ${name}`);
    error.code = "SMTP_CONFIGURATION_ERROR";
    throw error;
  }
  return value;
}

function booleanValue(value, name) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  const error = new Error(`Configurazione SMTP non valida: ${name}`);
  error.code = "SMTP_CONFIGURATION_ERROR";
  throw error;
}

export function smtpSettings(getEnv = runtimeEnv) {
  const port = Number(required(getEnv, "SMTP_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error("Configurazione SMTP non valida: SMTP_PORT");
    error.code = "SMTP_CONFIGURATION_ERROR";
    throw error;
  }
  return {
    host: required(getEnv, "SMTP_HOST"),
    port,
    secure: booleanValue(required(getEnv, "SMTP_SECURE"), "SMTP_SECURE"),
    user: required(getEnv, "SMTP_USER"),
    password: required(getEnv, "SMTP_PASSWORD"),
    fromEmail: required(getEnv, "ORDER_EMAIL_FROM"),
    fromName: required(getEnv, "ORDER_EMAIL_NAME"),
  };
}

// Validate before the SMTP handoff. Reject duplicates rather than silently
// moving a recipient from CC to To or altering an approved payload.
export function normalizeTransportRecipients(to, cc = []) {
  try {
    if (typeof to === 'string' && Array.isArray(cc) && cc.length === 0) {
      return {to:[normalizeEmailRecipients({recipient:to}).recipient], cc:[]};
    }
    const recipients = normalizeEmailRecipients({to:typeof to === 'string' ? [to] : to, cc});
    return {to:recipients.to, cc:recipients.cc};
  } catch {
    throw Object.assign(new Error('Destinatari email non validi.'), {code:'EENVELOPE'});
  }
}

export function createSmtpClient({
  getEnv = runtimeEnv,
  createTransport = nodemailer.createTransport.bind(nodemailer),
} = {}) {
  const settings = smtpSettings(getEnv);
  const transport = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: {
      user: settings.user,
      pass: settings.password,
    },
    connectionTimeout: 300_000,
    greetingTimeout: 300_000,
    socketTimeout: 300_000,
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    },
  });

  return {
    async send({ to, cc = [], bcc, subject, text, html, attachments = [] }) {
      if (bcc !== undefined) throw Object.assign(new Error('BCC non supportato.'), {code:'EENVELOPE'});
      const recipients = normalizeTransportRecipients(to, cc);
      if (typeof subject !== 'string' || /[\r\n]/.test(subject)) {
        throw Object.assign(new Error('Oggetto email non valido.'), {code:'EENVELOPE'});
      }
      const result = await transport.sendMail({
        from: {
          name: settings.fromName,
          address: settings.fromEmail,
        },
        to: typeof to === 'string' ? recipients.to[0] : recipients.to,
        ...(recipients.cc.length ? {cc:recipients.cc} : {}),
        envelope: {from:settings.fromEmail, to:[...recipients.to, ...recipients.cc]},
        subject,
        text,
        html,
        attachments,
      });
      const accepted = result?.accepted || [];
      const rejected = result?.rejected || [];
      const acceptedAddresses = new Set(accepted.map(value => String(value).trim().toLowerCase()));
      const requested = [...recipients.to, ...recipients.cc];
      // Nodemailer canonicalizes its actual envelope (for example an IDN
      // domain to punycode). Comparing accepted recipients with the original
      // string would turn successful legacy sends into false partial failures.
      // Older/custom transports may omit envelope; retain single-recipient
      // compatibility in that case, while v2 still checks every requested To/CC.
      const expected = Array.isArray(result?.envelope?.to) ? result.envelope.to
        : typeof to === 'string' && recipients.cc.length === 0 ? accepted : requested;
      if (!accepted.length || rejected.length || expected.length !== requested.length
          || expected.some(value => !acceptedAddresses.has(String(value).trim().toLowerCase()))) {
        // Nodemailer can hand DATA to accepted recipients even if other RCPTs
        // were rejected. Partial acceptance must never look safe to resend.
        const error = new Error('Accettazione SMTP incompleta.');
        error.code = accepted.length ? 'EPARTIALDELIVERY' : rejected.length ? 'EENVELOPE' : 'EDELIVERYUNCERTAIN';
        throw error;
      }
      return {
        provider: "smtp_aruba",
        messageId: String(result?.messageId || "").trim() || null,
        accepted,
        rejected,
        response: result?.response || null,
      };
    },
  };
}

export function isPermanentSmtpError(error) {
  if (['EPARTIALDELIVERY','EDELIVERYUNCERTAIN'].includes(error?.code)) return false;
  const responseCode = Number(error?.responseCode);
  return error?.code === "EAUTH"
    || error?.code === "EENVELOPE"
    || (Number.isInteger(responseCode) && responseCode >= 500 && responseCode <= 599);
}
