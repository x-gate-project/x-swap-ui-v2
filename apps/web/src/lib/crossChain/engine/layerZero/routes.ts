import { WRAPPED_NATIVE_CURRENCY } from 'constants/tokens'
import { USDC_SEPOLIA, USDT_SEPOLIA } from 'uniswap/src/constants/tokens'
import { UniverseChainId } from 'uniswap/src/types/chains'
import { JOCX, JOCX_ADAPTER_JOC_ADDRESS, USDCX, USDTX } from 'lib/crossChain/constants'
import type { RouteEntry } from 'lib/crossChain/bridge'

// ponytail: OFT route mesh (USDTX/USDCX/JOCX) hardcoded — testnet only, no route API for it.
// Upgrade: derive from LZADAPTER_ADDRESS + OFT maps when mainnet OFTs ship.
const TESTNET_EVM_CHAINS = [
  UniverseChainId.Sepolia,
  // UniverseChainId.Avalanche_Fuji, // ponytail: temporarily hidden
  UniverseChainId.Base_Sepolia,
  UniverseChainId.ArbitrumSepolia,
  UniverseChainId.JocTestnet
]

const JOCX_MAP = JOCX as unknown as Record<number, { address: string }>
const USDTX_MAP = USDTX as unknown as Record<number, { address: string }>
const USDCX_MAP = USDCX as unknown as Record<number, { address: string }>

function meshRoutes(chainIds: number[], addresses: Record<number, { address: string }>, symbol: string): RouteEntry[] {
  const entries: RouteEntry[] = []
  for (const from of chainIds) {
    for (const to of chainIds) {
      if (from === to) {continue}
      const fromAddr = addresses[from]?.address
      const toAddr = addresses[to]?.address
      if (!fromAddr || !toAddr) {continue}
      entries.push({
        originChainId: from,
        originToken: fromAddr,
        originTokenSymbol: symbol,
        destinationChainId: to,
        destinationToken: toAddr,
        destinationTokenSymbol: symbol,
      })
    }
  }
  return entries
}

const JOCX_WITH_JOC_ADAPTER: Record<number, { address: string }> = {
  ...JOCX_MAP,
  [UniverseChainId.JocTestnet]: { address: JOCX_ADAPTER_JOC_ADDRESS[UniverseChainId.JocTestnet] },
}

function meshToHubRoutes(params: {
  meshChainIds: number[]
  meshTokens: Record<number, { address: string }>
  meshSymbol: string

  hubChainId: number
  hubToken: string
  hubSymbol: string
}): RouteEntry[] {
  const {
    meshChainIds,
    meshTokens,
    meshSymbol,
    hubChainId,
    hubToken,
    hubSymbol,
  } = params

  if (!hubToken) {return []}

  const entries: RouteEntry[] = []

  for (const chainId of meshChainIds) {
    const meshToken = meshTokens[chainId]?.address
    if (!meshToken) {continue}

    entries.push(
      {
        originChainId: chainId,
        originToken: meshToken,
        originTokenSymbol: meshSymbol,

        destinationChainId: hubChainId,
        destinationToken: hubToken,
        destinationTokenSymbol: hubSymbol,
      },
      {
        originChainId: hubChainId,
        originToken: hubToken,
        originTokenSymbol: hubSymbol,

        destinationChainId: chainId,
        destinationToken: meshToken,
        destinationTokenSymbol: meshSymbol,
      },
    )
  }

  return entries
}


export const OFT_ROUTES: RouteEntry[] = [
  // JOCX (EVM testnets) ↔ native JOC coin on JocTestnet
  ...meshToHubRoutes({
    meshChainIds: [
      UniverseChainId.Sepolia,
      // UniverseChainId.Avalanche_Fuji, // ponytail: temporarily hidden
      UniverseChainId.Base_Sepolia,
      UniverseChainId.ArbitrumSepolia,
    ],
    meshTokens: JOCX_MAP,
    meshSymbol: JOCX[UniverseChainId.Sepolia].symbol ?? 'JOCX',

    hubChainId: UniverseChainId.JocTestnet,
    hubToken: WRAPPED_NATIVE_CURRENCY[UniverseChainId.JocTestnet]!.address,
    hubSymbol: 'JOCT',
  }),
  ...meshToHubRoutes({
    meshChainIds: [
      UniverseChainId.JocTestnet,
      UniverseChainId.ArbitrumSepolia,
      // UniverseChainId.Avalanche_Fuji, // ponytail: temporarily hidden
      UniverseChainId.Base_Sepolia,
    ],
    meshTokens: USDTX_MAP,
    meshSymbol: USDTX[UniverseChainId.Sepolia].symbol ?? 'USDTX',

    hubChainId: UniverseChainId.Sepolia,
    hubToken: USDT_SEPOLIA.address,
    hubSymbol: USDT_SEPOLIA.symbol || 'USDT',
  }),
  ...meshToHubRoutes({
    meshChainIds: [
      UniverseChainId.JocTestnet,
      UniverseChainId.ArbitrumSepolia,
      // UniverseChainId.Avalanche_Fuji, // ponytail: temporarily hidden
      UniverseChainId.Base_Sepolia,
    ],
    meshTokens: USDCX_MAP,
    meshSymbol: USDCX[UniverseChainId.Sepolia].symbol ?? 'USDCX',

    hubChainId: UniverseChainId.Sepolia,
    hubToken: USDC_SEPOLIA.address,
    hubSymbol: USDC_SEPOLIA.symbol || 'USDC',
  }),
  // USDTX / USDCX mesh: 4 EVM testnets ↔ JOC Testnet
  ...meshRoutes(TESTNET_EVM_CHAINS, USDTX, USDTX[UniverseChainId.Sepolia].symbol ?? 'USDTX'),
  ...meshRoutes(TESTNET_EVM_CHAINS, USDCX, USDCX[UniverseChainId.Sepolia].symbol ?? 'USDCX'),
  // JOCX mesh: 4 EVM testnets ↔ JOC Testnet
  ...meshRoutes(TESTNET_EVM_CHAINS, JOCX_WITH_JOC_ADAPTER, JOCX[UniverseChainId.Sepolia].symbol ?? 'JOCX'),

]
