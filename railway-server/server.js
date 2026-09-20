const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.QUICKDROP_DATA_DIR || "/data";
const MAX_MEDIA_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_CIPHERTEXT = 20 * 1024 * 1024;
const clips = new Map();
fs.mkdirSync(DATA_DIR, { recursive: true });

function headers(origin, extra = {}) {
  const allowed = origin && /^https:\/\/quickdrop(?:-[a-z0-9-]+)?-ria-d6b9\.vercel\.app$/.test(origin);
  return {
    "content-type": "application/json",
    "access-control-allow-origin": allowed ? origin : "https://quickdrop-pied-ten.vercel.app",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-quickdrop-meta",
    "cache-control": "no-store",
    ...extra
  };
}

function send(res, status, payload, origin) {
  res.writeHead(status, headers(origin));
  res.end(JSON.stringify(payload));
}

function validKey(key) { return /^[a-f0-9]{64}$/.test(key || ""); }
function validId(id) { return /^[a-zA-Z0-9_-]{8,80}$/.test(id || ""); }
function roomDir(key) { return path.join(DATA_DIR, key); }
function indexPath(key) { return path.join(roomDir(key), "media.json"); }
function clipPath(key) { return path.join(roomDir(key), "clip.json"); }
function readClip(key) {
  try { return JSON.parse(fs.readFileSync(clipPath(key), "utf8")); } catch { return clips.get(key) || null; }
}
function writeClip(key, value) {
  fs.mkdirSync(roomDir(key), { recursive: true });
  fs.writeFileSync(clipPath(key), JSON.stringify(value));
}
function readMedia(key) {
  try { return JSON.parse(fs.readFileSync(indexPath(key), "utf8")); } catch { return []; }
}
function writeMedia(key, items) {
  fs.mkdirSync(roomDir(key), { recursive: true });
  fs.writeFileSync(indexPath(key), JSON.stringify(items));
}
function requestMediaUpload(req, res, key, id, origin) {
  const length = Number(req.headers["content-length"] || 0);
  if (!Number.isFinite(length) || length < 1 || length > MAX_MEDIA_BYTES) return send(res, 413, { error: "Media must be under 30 MB" }, origin);
  let meta;
  try {
    meta = JSON.parse(Buffer.from(req.headers["x-quickdrop-meta"] || "", "base64url").toString("utf8"));
    if (typeof meta.name !== "string" || typeof meta.type !== "string") throw new Error();
  } catch { return send(res, 400, { error: "Invalid media metadata" }, origin); }

  const dir = roomDir(key);
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, id + ".bin");
  const tempPath = finalPath + "." + crypto.randomUUID() + ".tmp";
  const file = fs.createWriteStream(tempPath);
  let received = 0, done = false;
  const fail = () => { if (done) return; done = true; file.destroy(); fs.rm(tempPath, { force: true }, () => {}); send(res, 400, { error: "Upload failed" }, origin); };
  req.on("data", chunk => { received += chunk.length; if (received > MAX_MEDIA_BYTES) req.destroy(); });
  req.on("aborted", fail);
  req.on("error", fail);
  file.on("error", fail);
  file.on("finish", () => {
    if (done) return;
    done = true;
    fs.renameSync(tempPath, finalPath);
    const items = readMedia(key).filter(item => item.id !== id);
    items.unshift({ id, name: meta.name, type: meta.type, size: received, updatedAt: Date.now() });
    writeMedia(key, items.slice(0, 100));
    send(res, 200, { ok: true }, origin);
  });
  req.pipe(file);
}
function streamMedia(req, res, key, id, origin) {
  const item = readMedia(key).find(x => x.id === id);
  const file = path.join(roomDir(key), id + ".bin");
  if (!item || !fs.existsSync(file)) return send(res, 404, { error: "Not found" }, origin);
  res.writeHead(200, headers(origin, { "content-type": "application/octet-stream", "content-length": fs.statSync(file).size }));
  fs.createReadStream(file).pipe(res);
}

function handler(req, res) {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") { res.writeHead(204, headers(origin)); return res.end(); }
  const url = new URL(req.url, "http://localhost");
  const key = url.searchParams.get("key") || "";
  if (url.pathname === "/health") return send(res, 200, { ok: true }, origin);

  if (url.pathname === "/clip") {
    if (req.method === "GET") {
      if (!validKey(key)) return send(res, 400, { error: "Invalid key" }, origin);
      return send(res, 200, readClip(key) || { ciphertext: null, updatedAt: null }, origin);
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; if (body.length > MAX_TEXT_CIPHERTEXT + 50_000) req.destroy(); });
      req.on("end", () => {
        try {
          const payload = JSON.parse(body);
          const roomKey = key || payload.key || "";
          const { ciphertext, updatedAt } = payload;
          if (!validKey(roomKey) || typeof ciphertext !== "string" || ciphertext.length > MAX_TEXT_CIPHERTEXT || !Number.isSafeInteger(updatedAt)) throw new Error();
          const value = { ciphertext, updatedAt };
          clips.set(roomKey, value);
          try { writeClip(roomKey, value); } catch (error) { console.error("QuickDrop disk backup failed:", error.message); }
          send(res, 200, { ok: true }, origin);
        } catch { send(res, 400, { error: "Invalid request" }, origin); }
      });
      return;
    }
  }

  if (url.pathname === "/media") {
    if (!validKey(key)) return send(res, 400, { error: "Invalid key" }, origin);
    if (req.method === "GET") return send(res, 200, { items: readMedia(key) }, origin);
    if (req.method === "POST") {
      const id = url.searchParams.get("id");
      if (!validId(id)) return send(res, 400, { error: "Invalid upload id" }, origin);
      return requestMediaUpload(req, res, key, id, origin);
    }
  }

  if (url.pathname === "/media/file" && req.method === "GET") {
    if (!validKey(key) || !validId(url.searchParams.get("id"))) return send(res, 400, { error: "Invalid request" }, origin);
    return streamMedia(req, res, key, url.searchParams.get("id"), origin);
  }

  res.setHeader("allow", "GET, POST, OPTIONS");
  return send(res, 404, { error: "Not found" }, origin);
}

const ports = [...new Set([3000, Number(process.env.PORT)].filter(Number.isInteger))];
for (const port of ports) {
  http.createServer(handler).listen(port, "0.0.0.0", () => console.log(`QuickDrop sync ready on port ${port}`));
}