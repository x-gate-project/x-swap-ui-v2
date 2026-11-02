// Proxies /api/xswap/* to the x-swap API (xswap-router-worker), which sends no CORS headers.
// Set XSWAP_API_URL in the Vercel project to the API origin, e.g. https://xswap-api.example.com
// The client points REACT_APP_XSWAP_API_URL at /api/xswap/v1.
const XSWAP_API_URL = (process.env.XSWAP_API_URL || '').replace(/\/+$/, '')

export default async function handler(req, res) {
  if (!XSWAP_API_URL) {
    return res.status(503).json({ code: 'proxy_not_configured', message: 'XSWAP_API_URL is not set' })
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ code: 'method_not_allowed', message: 'Method not allowed' })
  }

  const url = req.url || ''
  const [pathPart, queryPart] = url.split('?')
  const restPath = pathPart.replace(/^\/?api\/xswap\/?/, '/')
  // Vercel adds the catch-all segment as a query param; drop it.
  const params = new URLSearchParams(queryPart || '')
  params.delete('path')
  params.delete('[...path]')
  const query = params.toString() ? `?${params.toString()}` : ''

  const headers = { accept: 'application/json' }
  const requestId = req.headers['x-request-id']
  if (typeof requestId === 'string') headers['x-request-id'] = requestId

  let body
  if (req.method === 'POST') {
    headers['content-type'] = 'application/json'
    let data = req.body
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch (e) {
        // forward as is
      }
    }
    body = typeof data === 'string' ? data : JSON.stringify(data ?? {})
  }

  try {
    const upstream = await fetch(`${XSWAP_API_URL}${restPath}${query}`, { method: req.method, headers, body })
    const text = await upstream.text()
    const upstreamRequestId = upstream.headers.get('x-request-id')
    if (upstreamRequestId) res.setHeader('x-request-id', upstreamRequestId)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    return res.status(upstream.status).send(text)
  } catch (e) {
    return res.status(502).json({ code: 'upstream_failed', message: String(e) })
  }
}
