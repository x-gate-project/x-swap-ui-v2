import {
  USDC_ARBITRUM_SEPOLIA,
  USDT_SEPOLIA,
  USDC_SEPOLIA,
  USDTX as USDTX_TOKENS,
  USDCX as USDCX_TOKENS,
  JOCX as JOCX_TOKENS,
  JOCX_ADAPTER_JOC_MAINNET,
  JOCX_ADAPTER_JOC_TESTNET,
  USDC_MAINNET,
  USDT,
  USDC_BSC,
  USDT_BSC,
  USDC_BASE,
  USDT_BASE,
  USDC_ARBITRUM,
  USDT_ARBITRUM,
  USDC_OPTIMISM,
  USDT_OPTIMISM,
  USDC_AVALANCHE,
  USDT_AVALANCHE,
} from 'uniswap/src/constants/tokens';
import {
  UniverseChainId,
} from 'uniswap/src/types/chains'

export const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

// XChainSender/LZAdapter contract's native sentinel (zero address, i.e. Solidity's
// Constants.ETH) — different from NATIVE_SENTINEL above, which is the Across API's own
// convention used only by routeEngine for token-list matching. Never mix the two: passing
// NATIVE_SENTINEL as XChainSender.send()'s inputToken makes the contract treat it as an
// ERC20 and attempt transferFrom(), reverting with TRANSFER_FROM_FAILED (see e2e/layerzero/
// japan-open-chain-testnet/joc/bridge.e2e.ts in x-chain-sender).
export const XCHAINSENDER_NATIVE_SENTINEL = '0x0000000000000000000000000000000000000000'


// EIP-1559 fee buffer multiplier (tenths, e.g. 15n = 1.5x) applied to the freshly estimated
// maxFeePerGas right before sending a tx. Arbitrum Sepolia gets its own bypass-cache path
// (see useCrossChainCallback.ts) instead of a bigger multiplier here, because the buffer
// wasn't the problem — the estimate itself was stale.
export const DEFAULT_FEE_BUFFER_MULTIPLIER = 15n

// Single source of truth for all token chainId/address/decimals/symbol/name definitions
// lives in packages/uniswap/src/constants/tokens.ts. This file just re-exposes the subset
// used by cross-chain routing (as Token instances, which already have .address/.symbol/.decimals).
export const JOCX_ADAPTER_JOC_ADDRESS: Record<number, `0x${string}`> = {
  [UniverseChainId.JocMainnet]: JOCX_ADAPTER_JOC_MAINNET.address as `0x${string}`,
  [UniverseChainId.JocTestnet]: JOCX_ADAPTER_JOC_TESTNET.address as `0x${string}`,
}

export const USDTX = USDTX_TOKENS
export const USDCX = USDCX_TOKENS
export const JOCX = JOCX_TOKENS


/**
 * High-priority stablecoins registry (USDC and USDT)
 * These tokens get the highest priority when selecting intermediate tokens
 * Addresses should be defined in lowercase for evm chains
 */
export const PRIORITY_STABLECOINS: Record<number, { address: string; symbol: string; decimals: number }[]> = {
  [UniverseChainId.Mainnet]: [
    { address: USDC_MAINNET.address, symbol: USDC_MAINNET.symbol ?? 'USDC', decimals: USDC_MAINNET.decimals },
    { address: USDT.address, symbol: USDT.symbol ?? 'USDT', decimals: USDT.decimals },
  ],
  [UniverseChainId.Bnb]: [
    { address: USDC_BSC.address, symbol: USDC_BSC.symbol ?? 'USDC', decimals: USDC_BSC.decimals },
    { address: USDT_BSC.address, symbol: USDT_BSC.symbol ?? 'USDT', decimals: USDT_BSC.decimals },
  ],
  [UniverseChainId.Base]: [
    { address: USDC_BASE.address, symbol: USDC_BASE.symbol ?? 'USDC', decimals: USDC_BASE.decimals },
    { address: USDT_BASE.address, symbol: USDT_BASE.symbol ?? 'USDT', decimals: USDT_BASE.decimals },
  ],
  [UniverseChainId.ArbitrumOne]: [
    { address: USDC_ARBITRUM.address, symbol: USDC_ARBITRUM.symbol ?? 'USDC', decimals: USDC_ARBITRUM.decimals },
    { address: USDT_ARBITRUM.address, symbol: USDT_ARBITRUM.symbol ?? 'USDT', decimals: USDT_ARBITRUM.decimals },
  ],
  [UniverseChainId.Optimism]: [
    { address: USDC_OPTIMISM.address, symbol: USDC_OPTIMISM.symbol ?? 'USDC', decimals: USDC_OPTIMISM.decimals },
    { address: USDT_OPTIMISM.address, symbol: USDT_OPTIMISM.symbol ?? 'USDT', decimals: USDT_OPTIMISM.decimals },
  ],
  [UniverseChainId.Avalanche]: [
    { address: USDC_AVALANCHE.address, symbol: USDC_AVALANCHE.symbol ?? 'USDC', decimals: USDC_AVALANCHE.decimals },
    { address: USDT_AVALANCHE.address, symbol: USDT_AVALANCHE.symbol ?? 'USDT', decimals: USDT_AVALANCHE.decimals },
  ],
  [UniverseChainId.JocMainnet]: [

    {
      address: USDCX[UniverseChainId.JocMainnet].address,
      symbol: 'USDCX',
      decimals: 6
    },
    {
      address: USDTX[UniverseChainId.JocMainnet].address,
      symbol: 'USDTX',
      decimals: 6
    },
    {
      address: JOCX_ADAPTER_JOC_ADDRESS[UniverseChainId.JocMainnet],
      symbol: 'JOCX',
      decimals: 18
    },
  ],
  [UniverseChainId.JocTestnet]: [
    {
      address: USDCX[UniverseChainId.JocTestnet].address,
      symbol: 'USDCX',
      decimals: 6
    },
    {
      address: USDTX[UniverseChainId.JocTestnet].address,
      symbol: 'USDTX',
      decimals: 6
    },
    {
      address: JOCX_ADAPTER_JOC_ADDRESS[UniverseChainId.JocTestnet],
      symbol: 'JOCX',
      decimals: 18
    },
  ],
  [UniverseChainId.Sepolia]: [
    {
      address: USDT_SEPOLIA.address,
      symbol: USDT_SEPOLIA.symbol || 'USDT',
      decimals: USDT_SEPOLIA.decimals
    },
    {
      address: USDC_SEPOLIA.address,
      symbol: USDC_SEPOLIA.symbol || 'USDC',
      decimals: USDC_SEPOLIA.decimals
    },
  ],
  [UniverseChainId.ArbitrumSepolia]: [
    {
      address: USDC_ARBITRUM_SEPOLIA.address,
      symbol: USDC_ARBITRUM_SEPOLIA.symbol || 'USDC',
      decimals: USDC_ARBITRUM_SEPOLIA.decimals
    },
  ],
}

/** OFT tokens with no on-chain liquidity pool — never valid as the swap-leg token on dest chain
 * (BRIDGE_SWAP's post-bridge swap, or SWAP_BRIDGE_SWAP's second swap). */
export const NON_SWAPPABLE_DEST_OFT_SYMBOLS = new Set(['usdtx', 'usdcx'])

export const STABLECOIN_SYMBOLS = new Set([
  'usdc',
  'usdt',
  'dai',
  'frax',
  'lusd',
  'usde',
  'pyusd',
  'usdc.e',
  'usdt.e',
])

export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

export const XCHAINSENDER_ADDRESS: Record<number, `0x${string}`> = {
  [UniverseChainId.Sepolia]: '0x81043e93fb01c09527e5ee91c7e89306599ad19a',
  [UniverseChainId.JocTestnet]: '0x81043e93fb01c09527e5ee91c7e89306599ad19a',
  [UniverseChainId.ArbitrumSepolia]: '0x81043e93fb01c09527e5ee91c7e89306599ad19a',
  [UniverseChainId.Base_Sepolia]: '0x81043e93fb01c09527e5ee91c7e89306599ad19a',
  [UniverseChainId.Avalanche_Fuji]: '0x81043e93fb01c09527e5ee91c7e89306599ad19a'
}

export const LZADAPTER_ADDRESS: Record<number, `0x${string}`> = {
  [UniverseChainId.Sepolia]: '0x7aec29eafb646f5d29b6c3eea9684f88f46a1c40',
  [UniverseChainId.JocTestnet]: '0x7aec29eafb646f5d29b6c3eea9684f88f46a1c40',
  [UniverseChainId.ArbitrumSepolia]: '0x7aec29eafb646f5d29b6c3eea9684f88f46a1c40',
  [UniverseChainId.Base_Sepolia]: '0x7aec29eafb646f5d29b6c3eea9684f88f46a1c40',
  [UniverseChainId.Avalanche_Fuji]: '0x7aec29eafb646f5d29b6c3eea9684f88f46a1c40'
}

export const ACROSSADAPTER_ADDRESS: Record<number, `0x${string}`> = {
  [UniverseChainId.Sepolia]: '0xfc0a97351caebd19e5bc0cd2f6d0d53734acb2dc',
  [UniverseChainId.ArbitrumSepolia]: '0xfc0a97351caebd19e5bc0cd2f6d0d53734acb2dc',
  [UniverseChainId.Base_Sepolia]: '0xfc0a97351caebd19e5bc0cd2f6d0d53734acb2dc',
}

export const ACROSS_TESTNET_CHAIN_IDS = new Set<number>([
  UniverseChainId.Sepolia,
  UniverseChainId.JocTestnet,
  UniverseChainId.ArbitrumSepolia,
  UniverseChainId.Base_Sepolia,
])

export const ACROSS_API_BASE = {
  testnet: 'https://testnet.across.to/api',
  mainnet: 'https://app.across.to/api',
}

export const OFT_TOKEN_SYMBOLS = new Set(
  [
    USDTX[UniverseChainId.Mainnet].symbol,
    USDCX[UniverseChainId.Mainnet].symbol,
    JOCX[UniverseChainId.Mainnet].symbol
  ]
)

const OFT_MAPS: Record<string, Record<number, { address: string }>> = {
  USDTX,
  USDCX,
  JOCX,
}

/** OFT contract address for a symbol (USDTX/USDCX/JOCX) on a given chain, or undefined if not deployed there. */
export function getOftAddress(symbol: string, chainId: number): `0x${string}` | undefined {
  return OFT_MAPS[symbol.toUpperCase()]?.[chainId]?.address as `0x${string}` | undefined
}

/** Underlying stablecoin symbol -> its OFT wrapper symbol (USDTX/USDCX). */
export const UNDERLYING_TO_OFT_SYMBOL: Record<string, string> = { USDT: 'USDTX', USDC: 'USDCX' }

export interface TokenLike {
  address?: string
  symbol?: string
  chainId: number
  isToken?: boolean
}

/**
 * True if sell=USDT/USDC and buy is genuinely that chain's deployed USDTX/USDCX contract.
 * Verifies via getOftAddress (real on-chain address), not just symbol match.
 */
export function isStablecoinToOftPair(sell: TokenLike, buy: TokenLike): boolean {
  const oftSymbol = UNDERLYING_TO_OFT_SYMBOL[(sell.symbol ?? '').toUpperCase()]
  if (!oftSymbol || (buy.symbol ?? '').toUpperCase() !== oftSymbol) return false
  const expected = getOftAddress(oftSymbol, buy.chainId)
  return !!expected && !!buy.address && buy.address.toLowerCase() === expected.toLowerCase()
}

/** Reverse: sell is genuinely deployed USDTX/USDCX, buy is its underlying USDT/USDC (burn-to-origin). */
export function isOftToStablecoinPair(sell: TokenLike, buy: TokenLike): boolean {
  const sellSymbol = (sell.symbol ?? '').toUpperCase()
  const underlyingSymbol = Object.entries(UNDERLYING_TO_OFT_SYMBOL).find(([, oft]) => oft === sellSymbol)?.[0]
  if (!underlyingSymbol || (buy.symbol ?? '').toUpperCase() !== underlyingSymbol) return false
  const expected = getOftAddress(sellSymbol, sell.chainId)
  return !!expected && !!sell.address && sell.address.toLowerCase() === expected.toLowerCase()
}



export const LZ_RECEIVE_GAS = {
  JOCX_SEND: 66274,
  JOCX_BURN: 63045,
  JOCX_MINT: 105448,
  OFTX_SEND: 41933,
  OFTX_BURN: 78617,
  /** compose gas for burn-to-origin unwrap (lzCompose) */
  OFTX_BURN_COMPOSE: 82496,
  /** lzReceive gas when a composeMsg is attached (dst-chain swap after bridge) —
   * endpoint decodes+forwards the compose payload inline, costing more than plain send.
   * Binary-searched value from x-chain-sender e2e (JOCX_LZ_RECEIVE_GAS_WITH_COMPOSE). */
  SWAP_COMPOSE: 150_000,
} as const

// ponytail: fixed composeGas const, not eth_estimateGas-probed like x-chain-sender e2e's
// estimateComposeGas (eth_call binary search) — raise this if the lzCompose swap runs out
// of gas on dst chain. Add real estimation only if that happens in practice.
export const SWAP_COMPOSE_GAS = 1_000_000n



/** CONTRACT_BALANCE sentinel — signals "use entire contract balance" */
export const CONTRACT_BALANCE = BigInt('0x8000000000000000000000000000000000000000000000000000000000000000')

/** XChainSender command IDs */
export const CMD_SWAP    = 0n
export const CMD_BRIDGE  = 1n
export const CMD_CONVERT = 6n

/** mint(uint256) selector — used by CONVERT command to mint OFT from its underlying (1:1) */
export const MINT_SELECTOR: `0x${string}` = '0xa0712d68'


export const PERMIT_DETAILS_TYPE = [
  { name: 'token',      type: 'address' },
  { name: 'amount',     type: 'uint160' },
  { name: 'expiration', type: 'uint48'  },
  { name: 'nonce',      type: 'uint48'  },
] as const

export const PERMIT_SINGLE_TYPE = [
  { name: 'details',     type: 'PermitDetails' },
  { name: 'spender',     type: 'address'       },
  { name: 'sigDeadline', type: 'uint256'        },
] as const