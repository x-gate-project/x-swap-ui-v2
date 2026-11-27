import { UNIVERSAL_ROUTER_ADDRESS } from '@uniswap/universal-router-sdk'

/**
 * The Universal Router on `chainId`, or undefined on a chain the SDK does not know. `UNIVERSAL_ROUTER_ADDRESS` throws
 * there, and x-swap enables such chains (e.g. Arbitrum Sepolia, Base Sepolia): their swaps go through the API, which
 * names its own spender, so the router is not needed.
 */
export function getUniversalRouterAddress(chainId?: number): string | undefined {
  if (!chainId) {
    return undefined
  }
  try {
    return UNIVERSAL_ROUTER_ADDRESS(chainId)
  } catch {
    return undefined
  }
}
