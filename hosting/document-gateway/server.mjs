import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

const PORT = Number(process.env.DOC_GATEWAY_PORT || 8787);
const HOST = "127.0.0.1";
const ROOT = String(process.env.DOC_GATEWAY_ROOT || "").trim();
const SECRET = String(process.env.DOC_GATEWAY_SECRET || "").trim();
const MAX_MANIFEST_FILES = Number(process.env.DOC_GATEWAY_MAX_FILES || 50000);
const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov", ".m4v"]);

if (!ROOT) throw new Error("DOC_GATEWAY_ROOT non configurato.");
if (SECRET.length < 32) throw new Error("DOC_GATEWAY_SECRET deve contenere almeno 32 caratteri.");

const MIME = new Map([
  [".pdf", "application/pdf"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".png", "image/png"], [".webp", "image/webp"], [".gif", "image/gif"],
  [".mp4", "video/mp4"], [".webm", "video/webm"], [".mov", "video/quicktime"], [".m4v", "video/x-m4v"],
]);

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}

function expectedSignature(pathname, expires) {
  return createHmac("sha256", SECRET).update(`${pathname}\n${expires}`).digest("hex");
}

function authorized(url) {
  const expires = Number(url.searchParams.get("expires"));
  const supplied = String(url.searchParams.get("signature") || "");
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000) || expires > Math.floor(Date.now() / 1000) + 900) return false;
  const expected = expectedSignature(url.pathname, expires);
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function safeRelativePath(encodedPath) {
  const decoded = decodeURIComponent(encodedPath).replaceAll("\\", "/");
  const normalized = path.posix.normalize(`/${decoded}`).slice(1);
  if (!normalized || normalized.startsWith("../") || normalized.includes("/../") || path.isAbsolute(normalized)) throw new Error("Percorso non valido.");
  return normalized;
}

async function resolveSafeFile(relative) {
  const rootReal = await realpath(ROOT);
  const candidate = path.resolve(rootReal, ...relative.split("/"));
  const fileReal = await realpath(candidate);
  const prefix = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;
  if (!fileReal.startsWith(prefix)) throw new Error("Percorso esterno all’archivio.");
  const stats = await lstat(fileReal);
  if (!stats.isFile()) throw new Error("File non valido.");
  return { fileReal, stats };
}

async function scanDirectory(directory, relative = "", output = []) {
  if (output.length >= MAX_MANIFEST_FILES) return output;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const childPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await scanDirectory(childPath, childRelative, output);
    else if (entry.isFile() && ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const stats = await lstat(childPath);
      output.push({ path: childRelative.replaceAll("\\", "/"), name: entry.name, extension: path.extname(entry.name).toLowerCase(), size: stats.size, modifiedAt: stats.mtime.toISOString(), category: childRelative.split("/")[0] || "Altro" });
    }
    if (output.length >= MAX_MANIFEST_FILES) break;
  }
  return output;
}

function serveFile(req, res, file, stats) {
  const extension = path.extname(file).toLowerCase();
  const contentType = MIME.get(extension) || "application/octet-stream";
  const range = req.headers.range;
  const common = { "Content-Type": contentType, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'", "Referrer-Policy": "no-referrer" };
  if (!range) {
    res.writeHead(200, { ...common, "Content-Length": stats.size });
    createReadStream(file).pipe(res);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) { res.writeHead(416, { "Content-Range": `bytes */${stats.size}` }); res.end(); return; }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), stats.size - 1) : stats.size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= stats.size) { res.writeHead(416, { "Content-Range": `bytes */${stats.size}` }); res.end(); return; }
  res.writeHead(206, { ...common, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${stats.size}` });
  createReadStream(file, { start, end }).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, service: "progre-document-gateway" });
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Metodo non consentito." });
    if (!authorized(url)) return json(res, 403, { error: "Collegamento non valido o scaduto." });
    if (url.pathname === "/manifest") {
      const files = await scanDirectory(await realpath(ROOT));
      return json(res, 200, { generatedAt: new Date().toISOString(), count: files.length, files });
    }
    if (url.pathname.startsWith("/files/")) {
      const relative = safeRelativePath(url.pathname.slice("/files/".length));
      const { fileReal, stats } = await resolveSafeFile(relative);
      if (req.method === "HEAD") { res.writeHead(200, { "Content-Length": stats.size, "Content-Type": MIME.get(path.extname(fileReal).toLowerCase()) || "application/octet-stream", "Accept-Ranges": "bytes" }); return res.end(); }
      return serveFile(req, res, fileReal, stats);
    }
    return json(res, 404, { error: "Risorsa non trovata." });
  } catch (error) {
    console.error(new Date().toISOString(), error.message);
    return json(res, error?.code === "ENOENT" ? 404 : 500, { error: error?.code === "ENOENT" ? "File non trovato." : "Errore gateway documentale." });
  }
});

server.listen(PORT, HOST, () => console.log(`Gateway documentale attivo su http://${HOST}:${PORT}`));
