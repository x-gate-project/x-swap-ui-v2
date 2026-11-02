/* eslint-env node */
// Dev-server only (loaded by react-scripts). The x-swap API sends no CORS headers, so local development reaches it
// through the same /api/xswap path the Vercel function (api/xswap) serves in production.
// Usage: XSWAP_API_PROXY_TARGET=http://localhost:3001 REACT_APP_XSWAP_API_URL=/api/xswap/v1 yarn start
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createProxyMiddleware } = require('http-proxy-middleware')

module.exports = function setupProxy(app) {
  const target = process.env.XSWAP_API_PROXY_TARGET
  if (!target) {
    return
  }
  app.use(
    '/api/xswap',
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: { '^/api/xswap': '' },
    }),
  )
}
