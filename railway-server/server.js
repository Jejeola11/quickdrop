const http = require("http");

const clips = new Map();

function headers(origin) {
  const allowed = origin && /^https:\/\/quickdrop(?:-[a-z0-9-]+)?-ria-d6b9\.vercel\.app$/.test(origin);
  return {
    "content-type": "application/json",
    "access-control-allow-origin": allowed ? origin : "https://quickdrop-pied-ten.vercel.app",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store"
  };
}

function send(res, status, payload, origin) {
  res.writeHead(status, headers(origin));
  res.end(JSON.stringify(payload));
}

http.createServer((req, res) => {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") { res.writeHead(204, headers(origin)); return res.end(); }

  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/health") return send(res, 200, { ok: true }, origin);
  if (url.pathname !== "/clip") return send(res, 404, { error: "Not found" }, origin);

  if (req.method === "GET") {
    const key = url.searchParams.get("key") || "";
    if (!/^[a-f0-9]{64}$/.test(key)) return send(res, 400, { error: "Invalid key" }, origin);
    const value = clips.get(key);
    return send(res, 200, value || { ciphertext: null, updatedAt: null }, origin);
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 3_800_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const { key, ciphertext, updatedAt } = JSON.parse(body);
        if (!/^[a-f0-9]{64}$/.test(key || "") || typeof ciphertext !== "string" || ciphertext.length > 3_500_000 || !Number.isSafeInteger(updatedAt)) return send(res, 400, { error: "Invalid request" }, origin);
        clips.set(key, { ciphertext, updatedAt });
        return send(res, 200, { ok: true }, origin);
      } catch { return send(res, 400, { error: "Invalid request" }, origin); }
    });
    return;
  }

  res.setHeader("allow", "GET, POST, OPTIONS");
  return send(res, 405, { error: "Method not allowed" }, origin);
}).listen(process.env.PORT || 3000, () => console.log("QuickDrop sync service ready"));