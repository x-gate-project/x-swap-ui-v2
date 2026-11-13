import { QueryClient } from '@tanstack/react-query'
import { injectedWithFallback } from 'components/Web3Provider/injectedWithFallback'
import { WC_PARAMS, uniswapWalletConnect } from 'components/Web3Provider/walletConnect'
import { getAppRpcUrls } from 'constants/appRpcUrls'
import { UNISWAP_LOGO } from 'ui/src/assets'
import { UNIVERSE_CHAIN_INFO } from 'uniswap/src/constants/chains'
import { UniverseChainId, WEB_SUPPORTED_CHAIN_IDS } from 'uniswap/src/types/chains'
import { createClient, fallback } from 'viem'
import { createConfig, http } from 'wagmi'
import { connect } from 'wagmi/actions'
import { coinbaseWallet, injected, safe, walletConnect } from 'wagmi/connectors'

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}

export const wagmiConfig = createConfig({
  chains: [
    UNIVERSE_CHAIN_INFO[UniverseChainId.Mainnet],
    ...WEB_SUPPORTED_CHAIN_IDS.map((chainId) => UNIVERSE_CHAIN_INFO[chainId]),
  ],
  connectors: [
    injectedWithFallback(),
    walletConnect(WC_PARAMS),
    uniswapWalletConnect(),
    coinbaseWallet({
      appName: 'Uniswap',
      appLogoUrl: UNISWAP_LOGO,
      reloadOnDisconnect: false,
      enableMobileWalletLink: true,
    }),
    safe(),
  ],
  client({ chain }) {
    // The chain's first app RPC, behind REACT_APP_RPC_URL_TEMPLATE's when that is set.
    const transports = getAppRpcUrls(chain.id, chain.rpcUrls.appOnly.http.slice(0, 1)).map((url) => http(url))
    return createClient({
      chain,
      batch: { multicall: true },
      pollingInterval: 12_000,
      transport: transports.length === 1 ? transports[0] : fallback(transports),
    })
  },
})

export const queryClient = new QueryClient()

// The Playwright e2e mock wallet (apps/web/e2e) sets this flag so the app connects to it on load.
if ((window as any).__XSWAP_E2E__?.eagerlyConnect) {
  connect(wagmiConfig, { connector: injected() })
}
