const endpoint = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command) {
  if (!endpoint || !token) throw new Error("Redis environment variables are missing");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error("Storage request failed");
  return response.json();
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") {
      const key = String(req.query.key || "");
      if (!/^[a-f0-9]{64}$/.test(key)) return res.status(400).json({ error: "Invalid key" });
      const data = await redis(["GET", `quickdrop:${key}`]);
      const saved = data.result ? JSON.parse(data.result) : null;
      return res.status(200).json({ ciphertext: saved?.ciphertext || null, updatedAt: saved?.updatedAt || null });
    }
    if (req.method === "POST") {
      const { key, ciphertext, updatedAt } = req.body || {};
      if (!/^[a-f0-9]{64}$/.test(key || "") || typeof ciphertext !== "string" || ciphertext.length > 3500000 || !Number.isSafeInteger(updatedAt)) return res.status(400).json({ error: "Invalid request" });
      await redis(["SET", `quickdrop:${key}`, JSON.stringify({ ciphertext, updatedAt })]);
      return res.status(200).json({ ok: true });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: "Sync is temporarily unavailable" });
  }
}
