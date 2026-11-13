const CHAIN_ID_PLACEHOLDER = '{chainId}'

/**
 * The RPC URLs the app reads `chainId` from, in order of preference.
 *
 * `REACT_APP_RPC_URL_TEMPLATE` is an optional RPC URL with a `{chainId}` placeholder, e.g.
 * `https://rpc.example.com/evm/{chainId}`. When set, it is tried before the chain's own `appOnly` RPCs, which stay as
 * fallbacks so that a chain the template does not serve still works. Unset, or without the placeholder, the chain's own
 * RPCs are used alone.
 */
export function getAppRpcUrls(chainId: number, chainRpcUrls: readonly string[]): string[] {
  const template = process.env.REACT_APP_RPC_URL_TEMPLATE
  if (!template || !template.includes(CHAIN_ID_PLACEHOLDER)) {
    return [...chainRpcUrls]
  }
  return [template.replace(CHAIN_ID_PLACEHOLDER, String(chainId)), ...chainRpcUrls]
}
