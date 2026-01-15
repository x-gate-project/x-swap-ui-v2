const UNISWAP_GATEWAY_URL = "https://interface.gateway.uniswap.org/v2";

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
    const [pathPart, queryPart] = url.split("?");
    const restPath = pathPart.replace(/^\/?api\/uniswap\/gateway\/?/, "/").replace(/^\/$/, "");
    let cleanQuery = queryPart ? `?${queryPart}` : "";
    cleanQuery = cleanQuery.replace(/&?\[\.\.\.path\]=[^&]*/g, "").replace(/^\?&/, "?").replace(/^\?$/, "");

    const upstream = `${UNISWAP_GATEWAY_URL}${restPath}${cleanQuery}`;

    try {
      const headers = { origin: "https://app.uniswap.org" };
      if (req.method === "POST") headers["content-type"] = "application/json";

      let body = undefined;
      if (req.method === "POST") {
        let bodyData = req.body;
        if (typeof bodyData === "string") {
          try {
            bodyData = JSON.parse(bodyData);
          } catch (e) {}
        }

        if (!bodyData || typeof bodyData !== "object") {
          bodyData = {};
        }

        body = JSON.stringify(bodyData);
      }

      const upstreamResp = await fetch(upstream, {
        method: req.method,
        headers,
        body,
      });

      const text = await upstreamResp.text();
      return res.status(upstreamResp.status).send(text);
    } catch (e) {
      return res.status(502).json({ error: "Upstream fetch failed", detail: String(e) });
    }
  }