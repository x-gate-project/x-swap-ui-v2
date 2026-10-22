import { Currency, Token, WETH9 } from '@uniswap/sdk-core'
import EthereumLogo from 'assets/images/ethereum-logo.png'
import AvaxLogo from 'assets/svg/avax_logo.svg'
import JoctLogo from 'assets/svg/joct_logo.svg'
import {
  ARB,
  BTC_BSC,
  BUSD_BSC,
  CEUR_CELO,
  CEUR_CELO_ALFAJORES,
  CUSD_CELO,
  CUSD_CELO_ALFAJORES,
  DAI,
  DAI_ARBITRUM_ONE,
  DAI_AVALANCHE,
  DAI_BSC,
  DAI_OPTIMISM,
  DAI_POLYGON,
  ETH_BSC,
  OP,
  PORTAL_ETH_CELO,
  USDC_ARBITRUM,
  USDC_ARBITRUM_GOERLI,
  USDC_AVALANCHE,
  USDC_BASE,
  USDC_BSC,
  USDC_CELO,
  USDC_CELO_ALFAJORES,
  USDC_MAINNET,
  USDC_OPTIMISM,
  USDC_OPTIMISM_GOERLI,
  USDC_POLYGON,
  USDC_POLYGON_MUMBAI,
  USDT,
  USDT_ARBITRUM_ONE,
  USDT_AVALANCHE,
  USDT_BSC,
  USDT_OPTIMISM,
  USDT_POLYGON,
  WBTC,
  WBTC_ARBITRUM_ONE,
  WBTC_CELO,
  WBTC_OPTIMISM,
  WBTC_POLYGON,
  WETH_AVALANCHE,
  WETH_POLYGON,
  WETH_POLYGON_MUMBAI,
  WRAPPED_NATIVE_CURRENCY,
  nativeOnChain,
} from 'constants/tokens'
import { getNativeLogoURI, getTokenLogoURI } from 'lib/hooks/useCurrencyLogoURIs'
import {
  JOCX,
  USDC_ARBITRUM_SEPOLIA,
  USDC_AVAX_FUJI,
  USDC_BASE_SEPOLIA,
  USDC_SEPOLIA,
  USDC_ZKSYNC,
  USDC_ZORA,
  USDCX,
  USDT_SEPOLIA,
  USDTX,
} from 'uniswap/src/constants/tokens'

import { UNIVERSE_CHAIN_INFO } from 'uniswap/src/constants/chains'
import { SafetyLevel } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { UniverseChainId } from 'uniswap/src/types/chains'

type ChainTokenList = {
  readonly [chainId: number]: Token[]
}

type ChainCurrencyList = {
  readonly [chainId: number]: CurrencyInfo[]
}

const WRAPPED_NATIVE_CURRENCIES_ONLY: ChainTokenList = Object.fromEntries(
  Object.entries(WRAPPED_NATIVE_CURRENCY)
    .map(([key, value]) => [key, [value]])
    .filter(Boolean),
)

// ponytail: testnet chains lack assetRepoNetworkName, so reuse mainnet logos by symbol.
// Drop once x-swap-token-list has testnet entries.
const XGATE_ASSETS = 'https://raw.githubusercontent.com/x-gate-project/x-gate-token-list/main/assets'
const UNI_ASSETS = 'https://raw.githubusercontent.com/Uniswap/assets/master/blockchains/ethereum/assets'
const LOGO_BY_SYMBOL: Record<string, string> = {
  WETH: EthereumLogo,
  WAVAX: AvaxLogo,
  USDC: `${UNI_ASSETS}/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png`,
  USDT: `${UNI_ASSETS}/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png`,
  USDTX: `${XGATE_ASSETS}/1_usdtx.svg`,
  USDCX: `${XGATE_ASSETS}/1_usdcx.svg`,
  JOCX: `${XGATE_ASSETS}/1_jocx.svg`,
}
// Testnets reuse JOC testnet (10081) logos; JOCX has no 10081 asset, so it uses the JOCT logo.
const TESTNET_LOGO_BY_SYMBOL: Record<string, string> = {
  USDTX: `${XGATE_ASSETS}/10081_usdtx.svg`,
  USDCX: `${XGATE_ASSETS}/10081_usdcx.svg`,
  JOCX: JoctLogo,
}

export function buildCurrencyInfo(commonBase: Currency): CurrencyInfo {
  const symbol = commonBase.symbol ?? ''
  const isTestnet = UNIVERSE_CHAIN_INFO[commonBase.chainId as UniverseChainId]?.testnet
  const logoUrl = commonBase.isNative
    ? getNativeLogoURI(commonBase.chainId)
    : getTokenLogoURI(commonBase.address, commonBase.chainId) ??
      (isTestnet ? TESTNET_LOGO_BY_SYMBOL[symbol] : undefined) ??
      LOGO_BY_SYMBOL[symbol]
  return {
    currency: commonBase,
    logoUrl,
    safetyLevel: SafetyLevel.Verified,
    isSpam: false,
  } as CurrencyInfo
}

/**
 * Shows up in the currency select for swap and add liquidity
 */
export const COMMON_BASES: ChainCurrencyList = {
  [UniverseChainId.Mainnet]: [
    nativeOnChain(UniverseChainId.Mainnet),
    DAI,
    USDC_MAINNET,
    USDT,
    WBTC,
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Mainnet] as Token,
  ].map(buildCurrencyInfo),
  [UniverseChainId.Goerli]: [
    nativeOnChain(UniverseChainId.Goerli),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Goerli] as Token,
  ].map(buildCurrencyInfo),
  [UniverseChainId.Sepolia]: [
    nativeOnChain(UniverseChainId.Sepolia),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Sepolia] as Token,
    USDC_SEPOLIA,
    USDT_SEPOLIA,
    USDTX[UniverseChainId.Sepolia],
    USDCX[UniverseChainId.Sepolia],
    JOCX[UniverseChainId.Sepolia],
  ].map(buildCurrencyInfo),
  [UniverseChainId.ArbitrumSepolia]: [
    nativeOnChain(UniverseChainId.ArbitrumSepolia),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.ArbitrumSepolia] as Token,
    USDC_ARBITRUM_SEPOLIA,
    USDTX[UniverseChainId.ArbitrumSepolia],
    USDCX[UniverseChainId.ArbitrumSepolia],
    JOCX[UniverseChainId.ArbitrumSepolia],
  ].map(buildCurrencyInfo),
  [UniverseChainId.Base_Sepolia]: [
    nativeOnChain(UniverseChainId.Base_Sepolia),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Base_Sepolia] as Token,
    USDC_BASE_SEPOLIA,
    USDTX[UniverseChainId.Base_Sepolia],
    USDCX[UniverseChainId.Base_Sepolia],
    JOCX[UniverseChainId.Base_Sepolia],
  ].map(buildCurrencyInfo),
  [UniverseChainId.Avalanche_Fuji]: [
    nativeOnChain(UniverseChainId.Avalanche_Fuji),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Avalanche_Fuji] as Token,
    USDC_AVAX_FUJI,
    USDTX[UniverseChainId.Avalanche_Fuji],
    USDCX[UniverseChainId.Avalanche_Fuji],
    JOCX[UniverseChainId.Avalanche_Fuji],
  ].map(buildCurrencyInfo),

  [UniverseChainId.ArbitrumOne]: [
    nativeOnChain(UniverseChainId.ArbitrumOne),
    ARB,
    DAI_ARBITRUM_ONE,
    USDC_ARBITRUM,
    USDT_ARBITRUM_ONE,
    WBTC_ARBITRUM_ONE,
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.ArbitrumOne] as Token,
  ].map(buildCurrencyInfo),
  [UniverseChainId.ArbitrumGoerli]: [
    nativeOnChain(UniverseChainId.ArbitrumGoerli),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.ArbitrumGoerli] as Token,
    USDC_ARBITRUM_GOERLI,
  ].map(buildCurrencyInfo),

  [UniverseChainId.Optimism]: [
    nativeOnChain(UniverseChainId.Optimism),
    OP,
    DAI_OPTIMISM,
    USDC_OPTIMISM,
    USDT_OPTIMISM,
    WBTC_OPTIMISM,
    WETH9[UniverseChainId.Optimism],
  ].map(buildCurrencyInfo),
  [UniverseChainId.OptimismGoerli]: [nativeOnChain(UniverseChainId.OptimismGoerli), USDC_OPTIMISM_GOERLI].map(
    buildCurrencyInfo,
  ),

  [UniverseChainId.Base]: [
    nativeOnChain(UniverseChainId.Base),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Base] as Token,
    USDC_BASE,
  ].map(buildCurrencyInfo),
  [UniverseChainId.Blast]: [
    nativeOnChain(UniverseChainId.Blast),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Blast] as Token,
  ].map(buildCurrencyInfo),

  [UniverseChainId.Polygon]: [
    nativeOnChain(UniverseChainId.Polygon),
    WETH_POLYGON,
    USDC_POLYGON,
    DAI_POLYGON,
    USDT_POLYGON,
    WBTC_POLYGON,
  ].map(buildCurrencyInfo),
  [UniverseChainId.PolygonMumbai]: [
    nativeOnChain(UniverseChainId.PolygonMumbai),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.PolygonMumbai] as Token,
    USDC_POLYGON_MUMBAI,
    WETH_POLYGON_MUMBAI,
  ].map(buildCurrencyInfo),

  [UniverseChainId.Celo]: [
    nativeOnChain(UniverseChainId.Celo),
    CEUR_CELO,
    CUSD_CELO,
    PORTAL_ETH_CELO,
    USDC_CELO,
    WBTC_CELO,
  ].map(buildCurrencyInfo),

  [UniverseChainId.CeloAlfajores]: [
    nativeOnChain(UniverseChainId.CeloAlfajores),
    CUSD_CELO_ALFAJORES,
    CEUR_CELO_ALFAJORES,
    USDC_CELO_ALFAJORES,
  ].map(buildCurrencyInfo),

  [UniverseChainId.Bnb]: [
    nativeOnChain(UniverseChainId.Bnb),
    DAI_BSC,
    USDC_BSC,
    USDT_BSC,
    ETH_BSC,
    BTC_BSC,
    BUSD_BSC,
  ].map(buildCurrencyInfo),

  [UniverseChainId.Avalanche]: [
    nativeOnChain(UniverseChainId.Avalanche),
    DAI_AVALANCHE,
    USDC_AVALANCHE,
    USDT_AVALANCHE,
    WETH_AVALANCHE,
  ].map(buildCurrencyInfo),

  [UniverseChainId.Zora]: [
    nativeOnChain(UniverseChainId.Zora),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Zora] as Token,
    USDC_ZORA,
  ].map(buildCurrencyInfo),

  [UniverseChainId.Zksync]: [
    nativeOnChain(UniverseChainId.Zksync),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.Zksync] as Token,
    USDC_ZKSYNC,
  ].map(buildCurrencyInfo),
  [UniverseChainId.JocTestnet]: [
    nativeOnChain(UniverseChainId.JocTestnet),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.JocTestnet] as Token,
  ].map(buildCurrencyInfo),
  [UniverseChainId.JocMainnet]: [
    nativeOnChain(UniverseChainId.JocMainnet),
    WRAPPED_NATIVE_CURRENCY[UniverseChainId.JocMainnet] as Token,
  ].map(buildCurrencyInfo),
}

// used to construct the list of all pairs we consider by default in the frontend
export const BASES_TO_TRACK_LIQUIDITY_FOR: ChainTokenList = {
  ...WRAPPED_NATIVE_CURRENCIES_ONLY,
  [UniverseChainId.Mainnet]: [
    ...WRAPPED_NATIVE_CURRENCIES_ONLY[UniverseChainId.Mainnet],
    DAI,
    USDC_MAINNET,
    USDT,
    WBTC,
  ],
  [UniverseChainId.Bnb]: [
    ...WRAPPED_NATIVE_CURRENCIES_ONLY[UniverseChainId.Bnb],
    DAI_BSC,
    USDC_BSC,
    USDT_BSC,
    BTC_BSC,
    BUSD_BSC,
    ETH_BSC,
  ],
  [UniverseChainId.Avalanche]: [
    ...WRAPPED_NATIVE_CURRENCIES_ONLY[UniverseChainId.Avalanche],
    DAI_AVALANCHE,
    USDC_AVALANCHE,
    USDT_AVALANCHE,
    WETH_AVALANCHE,
  ],
}

export const PINNED_PAIRS: { readonly [chainId: number]: [Token, Token][] } = {
  [UniverseChainId.Mainnet]: [
    [
      new Token(UniverseChainId.Mainnet, '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643', 8, 'cDAI', 'Compound Dai'),
      new Token(UniverseChainId.Mainnet, '0x39AA39c021dfbaE8faC545936693aC917d5E7563', 8, 'cUSDC', 'Compound USD Coin'),
    ],
    [USDC_MAINNET, USDT],
    [DAI, USDT],
  ],
}
