import nodemailer from "nodemailer";

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
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    },
  });

  return {
    async send({ to, subject, text, html, attachments = [] }) {
      const result = await transport.sendMail({
        from: {
          name: settings.fromName,
          address: settings.fromEmail,
        },
        to,
        subject,
        text,
        html,
        attachments,
      });
      const accepted = result?.accepted || [];
      const rejected = result?.rejected || [];
      if (!accepted.length || rejected.length) {
        const error = new Error("Il server SMTP ha rifiutato il destinatario.");
        error.code = "EENVELOPE";
        error.response = result?.response;
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
  const responseCode = Number(error?.responseCode);
  return error?.code === "EAUTH"
    || error?.code === "EENVELOPE"
    || (Number.isInteger(responseCode) && responseCode >= 500 && responseCode <= 599);
}
