/* global Buffer, process */
import crypto from "node:crypto";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const SECRET_PATTERN = /(authorization|cookie|token|secret|password|api[_-]?key|consumer[_-]?(key|secret)|developer[_-]?token)/i;

function encryptionKey(raw = process.env.CRM_CONNECTION_SECRET_KEY) {
  const value = String(raw || "").trim();
  const key = /^[a-f\d]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw Object.assign(new Error("CRM_CONNECTION_SECRET_KEY deve contenere 32 byte."), { status: 500 });
  return key;
}

export function encryptSecret(value, rawKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(rawKey), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    fingerprint: crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12),
  };
}

export function decryptSecret(row, rawKey) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(rawKey), Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function maskSecret(row) {
  return row ? `•••••••• · ${String(row.fingerprint || "").slice(-6)}` : null;
}

export function redact(value, key = "") {
  if (SECRET_PATTERN.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  return value;
}

export function safeError(error) {
  const status = Number(error?.status || 502);
  const message = String(error?.message || "Provider non raggiungibile.")
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/([?&](?:access_token|key|api_key|client_secret)=)[^&\s]+/gi, "$1[REDACTED]");
  return Object.assign(new Error(message.slice(0, 500)), { status: status >= 400 && status <= 599 ? status : 502, code: error?.code });
}

function isBlockedIpv4(ip) {
  const p = ip.split(".").map(Number);
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) ||
    (p[0] === 192 && p[1] === 0) || (p[0] === 198 && (p[1] === 18 || p[1] === 19));
}

export function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (!net.isIPv6(ip)) return true;
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isBlockedIpv4(mapped) : false;
}

async function resolvePublicHttpsUrl(input, { lookup = dns.lookup, allowedHosts = null } = {}) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password) throw Object.assign(new Error("È richiesto un URL HTTPS pubblico senza credenziali incorporate."), { status: 400 });
  if (allowedHosts && !allowedHosts.includes(url.hostname)) throw Object.assign(new Error("Host provider non consentito."), { status: 400 });
  if (["localhost", "metadata.google.internal"].includes(url.hostname.toLowerCase())) throw Object.assign(new Error("Host non pubblico."), { status: 400 });
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) throw Object.assign(new Error("L'host risolve a una rete privata o riservata."), { status: 400 });
  return { url, address: addresses[0].address, family: addresses[0].family };
}

export async function assertPublicHttpsUrl(input, dependencies = {}) {
  return (await resolvePublicHttpsUrl(input, dependencies)).url;
}

export async function safeFetch(input, options = {}, dependencies = {}) {
  const { url, address, family } = await resolvePublicHttpsUrl(input, dependencies);
  const timeoutMs = Math.min(Number(options.timeoutMs || 10000), 20000);
  const maxBytes = Math.min(Number(options.maxBytes || 1024 * 1024), 2 * 1024 * 1024);
  const transport = dependencies.transport || (url.protocol === "https:" ? https : http);
  return new Promise((resolve, reject) => {
    const request = transport.request(url, { method: options.method || "GET", headers: options.headers || {}, timeout: timeoutMs, lookup: (_hostname, lookupOptions, callback) => lookupOptions?.all ? callback(null, [{ address, family }]) : callback(null, address, family) }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (Number(options.redirects || 0) >= 2) return reject(Object.assign(new Error("Troppi redirect dal provider."), { status: 502 }));
        return resolve(safeFetch(new URL(response.headers.location, url).toString(), { ...options, redirects: Number(options.redirects || 0) + 1 }, dependencies));
      }
      let size = 0; const chunks = [];
      response.on("data", (chunk) => { size += chunk.length; if (size > maxBytes) request.destroy(Object.assign(new Error("Risposta provider troppo grande."), { status: 502 })); else chunks.push(chunk); });
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = text; try { data = text ? JSON.parse(text) : null; } catch { /* provider may return text */ }
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, headers: response.headers, data });
      });
    });
    request.on("timeout", () => request.destroy(Object.assign(new Error("Timeout provider."), { status: 504 })));
    request.on("error", (error) => reject(safeError(error)));
    if (options.body) request.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    request.end();
  });
}
