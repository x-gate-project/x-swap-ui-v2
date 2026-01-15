const UNISWAP_GRAPHQL_URL = "https://interface.gateway.uniswap.org/v1/graphql";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] || "Content-Type,Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const upstreamResp = await fetch(
      UNISWAP_GRAPHQL_URL,
      {
        method: "POST",
        headers: {
          origin: "https://app.uniswap.org",
          "content-type": "application/json",
        },
        body: JSON.stringify(req.body ?? {}),
      }
    );

    const text = await upstreamResp.text();
    res.setHeader("Content-Type", "application/json");
    return res.status(upstreamResp.status).send(text);
  } catch (e) {
    return res.status(502).json({ error: "Upstream fetch failed", detail: String(e) });
  }
}


