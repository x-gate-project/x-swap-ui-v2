const UNISWAP_BASE_URL = "https://interface.gateway.uniswap.org";

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      req.headers["access-control-request-headers"] || "Content-Type,Authorization"
    );
    if (req.method === "OPTIONS") return res.status(204).end();

    const url = req.url || "";
    const match = url.match(/^\/api\/uniswap\/base(\/[^?]*)?(\?.*)?$/);
    const restPath = match?.[1] || "";
    const queryString = match?.[2] || "";

    const cleanQuery = queryString.replace(/&?\[\.\.\.path\]=[^&]*/g, "").replace(/^\?&/, "?");

    const upstream = `${UNISWAP_BASE_URL}${restPath}${cleanQuery}`;

    try {
      const headers = { origin: "https://app.uniswap.org" };
      if (req.method === "POST") headers["content-type"] = "application/json";

      const upstreamResp = await fetch(upstream, {
        method: req.method,
        headers,
        body: req.method === "POST" ? JSON.stringify(req.body ?? {}) : undefined,
      });

      const text = await upstreamResp.text();
      res.setHeader("Content-Type", "application/json");
      return res.status(upstreamResp.status).send(text);
    } catch (e) {
      return res.status(502).json({ error: "Upstream fetch failed", detail: String(e) });
    }
}
