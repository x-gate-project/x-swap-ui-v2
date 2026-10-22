import { Token, UNI_ADDRESSES } from '@uniswap/sdk-core'
import { UniverseChainId } from 'uniswap/src/types/chains'

export const USDC_MAINNET = new Token(
  UniverseChainId.Mainnet,
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  6,
  'USDC',
  'USD//C',
)

export const USDC_GOERLI = new Token(
  UniverseChainId.Goerli,
  '0x07865c6e87b9f70255377e024ace6630c1eaa37f',
  6,
  'USDC',
  'USD//C',
)
export const USDC_SEPOLIA = new Token(
  UniverseChainId.Sepolia,
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  6,
  'USDC',
  'USD//C',
)

export const USDT_SEPOLIA = new Token(
  UniverseChainId.Sepolia,
  '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
  6,
  'USDT',
  'Tether USD',
)

export const USDC_ARBITRUM_SEPOLIA = new Token(
  UniverseChainId.ArbitrumSepolia,
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  6,
  'USDC',
  'USD//C',
)

export const USDTX_ARBITRUM_SEPOLIA = new Token(
  UniverseChainId.ArbitrumSepolia,
  '0xa937c170cd3fce86c246f19899642fa075064c23',
  6,
  'USDTX',
  'USDTX',
)

export const USDCX_ARBITRUM_SEPOLIA = new Token(
  UniverseChainId.ArbitrumSepolia,
  '0x154b535cabd5397fafe85b8a62f6ccdc8b2a1fdb',
  6,
  'USDCX',
  'USDCX',
)

export const JOCX_SEPOLIA = new Token(
  UniverseChainId.Sepolia,
  '0xB1660F8CDbf2102Ac74C6CD6d7CD6A65E481e5fe',
  18,
  'JOCX',
  'JOCX',
)

export const USDTX_MAINNET = new Token(
  UniverseChainId.Mainnet,
  '0x4ba87863374ed6d5e2d3a2aa6a2b036c1603180c',
  6,
  'USDTX',
  'USDTX',
)

export const USDCX_MAINNET = new Token(
  UniverseChainId.Mainnet,
  '0x5e80caf3d631ada4f71b915717766257fc8c684a',
  6,
  'USDCX',
  'USDCX',
)

export const JOCX_MAINNET = new Token(
  UniverseChainId.Mainnet,
  '0xbb1e1399eee1f577f1b4359224155f5db39ca084',
  18,
  'JOCX',
  'JOCX',
)

export const DAI = new Token(
  UniverseChainId.Mainnet,
  '0x6B175474E89094C44Da98b954EedeAC495271d0F',

  18,
  'DAI',
  'Dai Stablecoin',
)
export const USDT = new Token(
  UniverseChainId.Mainnet,
  '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  6,
  'USDT',
  'Tether USD',
)

export const DAI_OPTIMISM = new Token(
  UniverseChainId.Optimism,
  '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  18,
  'DAI',
  'Dai stable coin',
)
export const USDC_OPTIMISM = new Token(
  UniverseChainId.Optimism,
  '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  6,
  'USDC',
  'USD//C',
)
export const USDC_OPTIMISM_GOERLI = new Token(
  UniverseChainId.OptimismGoerli,
  '0xe05606174bac4A6364B31bd0eCA4bf4dD368f8C6',
  6,
  'USDC',
  'USD//C',
)

export const USDC_BASE = new Token(
  UniverseChainId.Base,
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  6,
  'USDC',
  'USD Coin',
)

export const USDC_BSC = new Token(UniverseChainId.Bnb, '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18, 'USDC', 'USDC')
export const USDT_BSC = new Token(UniverseChainId.Bnb, '0x55d398326f99059fF775485246999027B3197955', 18, 'USDT', 'USDT')

export const MATIC_POLYGON = new Token(
  UniverseChainId.Polygon,
  '0x0000000000000000000000000000000000001010',
  18,
  'MATIC',
  'Matic',
)
export const DAI_POLYGON = new Token(
  UniverseChainId.Polygon,
  '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  18,
  'DAI',
  'Dai Stablecoin',
)
export const USDC_POLYGON = new Token(
  UniverseChainId.Polygon,
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  6,
  'USDC',
  'USD Coin',
)
export const USDC_POLYGON_MUMBAI = new Token(
  UniverseChainId.PolygonMumbai,
  '0x0fa8781a83e46826621b3bc094ea2a0212e71b23',
  6,
  'USDC',
  'USD Coin',
)

export const USDB_BLAST = new Token(
  UniverseChainId.Blast,
  '0x4300000000000000000000000000000000000003',
  18,
  'USDB',
  'USDB',
)

export const USDC_ARBITRUM = new Token(
  UniverseChainId.ArbitrumOne,
  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  6,
  'USDC',
  'USD//C',
)
export const DAI_ARBITRUM_ONE = new Token(
  UniverseChainId.ArbitrumOne,
  '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  18,
  'DAI',
  'Dai stable coin',
)
export const USDC_ARBITRUM_GOERLI = new Token(
  UniverseChainId.ArbitrumGoerli,
  '0x8FB1E3fC51F3b789dED7557E680551d93Ea9d892',
  6,
  'USDC',
  'USD//C',
)

export const USDC_AVALANCHE = new Token(
  UniverseChainId.Avalanche,
  '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  6,
  'USDC',
  'USDC Token',
)

export const USDC_BASE_SEPOLIA = new Token(
  UniverseChainId.Base_Sepolia,
  '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  6,
  'USDC',
  'USDC',
)

export const USDC_AVAX_FUJI = new Token(
  UniverseChainId.Avalanche_Fuji,
  '0x5425890298aed601595a70AB815c96711a31Bc65',
  6,
  'USDC',
  'USDC',
)

export const USDC_CELO = new Token(
  UniverseChainId.Celo,
  '0xceba9300f2b948710d2653dd7b07f33a8b32118c',
  6,
  'USDC',
  'USD Coin',
)
export const CUSD_CELO = new Token(
  UniverseChainId.Celo,
  '0x765DE816845861e75A25fCA122bb6898B8B1282a',
  18,
  'cUSD',
  'Celo Dollar',
)
export const CUSD_CELO_ALFAJORES = new Token(
  UniverseChainId.CeloAlfajores,
  '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1',
  18,
  'CUSD',
  'Celo Dollar',
)

export const USDC_ZORA = new Token(
  UniverseChainId.Zora,
  '0xCccCCccc7021b32EBb4e8C08314bD62F7c653EC4',
  6,
  'USDC',
  'USD Coin',
)

export const USDC = new Token(
  UniverseChainId.Mainnet,
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  6,
  'USDC',
  'USD//C',
)

export const USDBC_BASE = new Token(
  UniverseChainId.Base,
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca',
  6,
  'USDbC',
  'USD Base Coin',
)
export const USDT_BNB = new Token(
  UniverseChainId.Bnb,
  '0x55d398326f99059ff775485246999027b3197955',
  18,
  'USDT',
  'TetherUSD',
)

export const USDT_BASE = new Token(
  UniverseChainId.Base,
  '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
  6,
  'USDT',
  'Tether USD',
)

export const USDT_ARBITRUM = new Token(
  UniverseChainId.ArbitrumOne,
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
  6,
  'USDT',
  'Tether USD',
)

export const USDT_OPTIMISM = new Token(
  UniverseChainId.Optimism,
  '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
  6,
  'USDT',
  'Tether USD',
)

export const USDT_AVALANCHE = new Token(
  UniverseChainId.Avalanche,
  '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
  6,
  'USDT',
  'Tether USD',
)

export const USDB = new Token(UniverseChainId.Blast, '0x4300000000000000000000000000000000000003', 18, 'USDB', 'USDB')


export const CUSD = new Token(UniverseChainId.Celo, '0x765de816845861e75a25fca122bb6898b8b1282a', 18, 'CUSD', 'CUSD')

export const USDzC = new Token(
  UniverseChainId.Zora,
  '0xCccCCccc7021b32EBb4e8C08314bD62F7c653EC4',
  6,
  'USDzC',
  'USD Coin',
)

export const USDC_ZKSYNC = new Token(
  UniverseChainId.Zksync,
  '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4',
  6,
  'USDC',
  'USDC',
)

export const USDTX_JOC_TESTNET = new Token(
  UniverseChainId.JocTestnet,
  '0x382eb09D8cE59968683001947EF04cB34f7A180E',
  6,
  'USDTX',
  'USDTX',
)

export const USDCX_JOC_TESTNET = new Token(
  UniverseChainId.JocTestnet,
  '0x367f476c9B5fA1e64F3d7EE19c3E4E2f76D42200',
  6,
  'USDCX',
  'USDCX',
)

export const USDTX_JOC_MAINNET = new Token(
  UniverseChainId.JocMainnet,
  '0xe18e898E5843E8a8EA7A1C4AF08730DcA6689aA9',
  6,
  'USDTX',
  'USDTX',
)

export const USDCX_JOC_MAINNET = new Token(
  UniverseChainId.JocMainnet,
  '0x538F7567f16cbE40d051e9f2928d215343D9A13A',
  6,
  'USDCX',
  'USDCX',
)

// JOCX adapter contracts deployed on the JOC chain itself (bridges JOCX <-> native JOC coin).
export const JOCX_ADAPTER_JOC_MAINNET = new Token(
  UniverseChainId.JocMainnet,
  '0xbb1E1399EEE1f577F1B4359224155f5Db39CA084',
  18,
  'JOCX',
  'JOCX',
)

export const JOCX_ADAPTER_JOC_TESTNET = new Token(
  UniverseChainId.JocTestnet,
  '0xB1660F8CDbf2102Ac74C6CD6d7CD6A65E481e5fe',
  18,
  'JOCX',
  'JOCX',
)

export const USDTX_BASE = new Token(
  UniverseChainId.Base,
  '0xe18e898e5843e8a8ea7a1c4af08730dca6689aa9',
  6,
  'USDTX',
  'USDTX',
)

export const USDTX_ARBITRUM_ONE = new Token(
  UniverseChainId.ArbitrumOne,
  '0xe18e898e5843e8a8ea7a1c4af08730dca6689aa9',
  6,
  'USDTX',
  'USDTX',
)

export const USDTX_AVALANCHE = new Token(
  UniverseChainId.Avalanche,
  '0xe18e898e5843e8a8ea7a1c4af08730dca6689aa9',
  6,
  'USDTX',
  'USDTX',
)

export const USDTX_SEPOLIA = new Token(
  UniverseChainId.Sepolia,
  '0x6c9322a8143fdaa3b482e5b8662bc649d1822424',
  6,
  'USDTX',
  'USDTX',
)

export const USDTX_BASE_SEPOLIA = new Token(
  UniverseChainId.Base_Sepolia,
  '0xa937c170cd3fce86c246f19899642fa075064c23',
  6,
  'USDTX',
  'USDTX',
)

export const USDTX_AVALANCHE_FUJI = new Token(
  UniverseChainId.Avalanche_Fuji,
  '0xa937c170cd3fce86c246f19899642fa075064c23',
  6,
  'USDTX',
  'USDTX',
)

export const USDCX_BASE = new Token(
  UniverseChainId.Base,
  '0x538f7567f16cbe40d051e9f2928d215343d9a13a',
  6,
  'USDCX',
  'USDCX',
)

export const USDCX_ARBITRUM_ONE = new Token(
  UniverseChainId.ArbitrumOne,
  '0x538f7567f16cbe40d051e9f2928d215343d9a13a',
  6,
  'USDCX',
  'USDCX',
)

export const USDCX_AVALANCHE = new Token(
  UniverseChainId.Avalanche,
  '0x538f7567f16cbe40d051e9f2928d215343d9a13a',
  6,
  'USDCX',
  'USDCX',
)

export const USDCX_SEPOLIA = new Token(
  UniverseChainId.Sepolia,
  '0xa937c170cd3fce86c246f19899642fa075064c23',
  6,
  'USDCX',
  'USDCX',
)

export const USDCX_BASE_SEPOLIA = new Token(
  UniverseChainId.Base_Sepolia,
  '0x154b535cabd5397fafe85b8a62f6ccdc8b2a1fdb',
  6,
  'USDCX',
  'USDCX',
)

export const USDCX_AVALANCHE_FUJI = new Token(
  UniverseChainId.Avalanche_Fuji,
  '0x154b535cabd5397fafe85b8a62f6ccdc8b2a1fdb',
  6,
  'USDCX',
  'USDCX',
)

export const JOCX_BASE = new Token(
  UniverseChainId.Base,
  '0xbb1e1399eee1f577f1b4359224155f5db39ca084',
  18,
  'JOCX',
  'JOCX',
)

export const JOCX_ARBITRUM_ONE = new Token(
  UniverseChainId.ArbitrumOne,
  '0xbb1e1399eee1f577f1b4359224155f5db39ca084',
  18,
  'JOCX',
  'JOCX',
)

export const JOCX_AVALANCHE = new Token(
  UniverseChainId.Avalanche,
  '0xbb1e1399eee1f577f1b4359224155f5db39ca084',
  18,
  'JOCX',
  'JOCX',
)

export const JOCX_AVALANCHE_FUJI = new Token(
  UniverseChainId.Avalanche_Fuji,
  '0xb1660f8cdbf2102ac74c6cd6d7cd6a65e481e5fe',
  18,
  'JOCX',
  'JOCX',
)

export const JOCX_BASE_SEPOLIA = new Token(
  UniverseChainId.Base_Sepolia,
  '0xb1660f8cdbf2102ac74c6cd6d7cd6a65e481e5fe',
  18,
  'JOCX',
  'JOCX',
)

export const JOCX_ARBITRUM_SEPOLIA = new Token(
  UniverseChainId.ArbitrumSepolia,
  '0xb1660f8cdbf2102ac74c6cd6d7cd6a65e481e5fe',
  18,
  'JOCX',
  'JOCX',
)

export const WBTC = new Token(
  UniverseChainId.Mainnet,
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',

  8,
  'WBTC',
  'Wrapped BTC',
)

export const UNI = {
  [UniverseChainId.Mainnet]: new Token(
    UniverseChainId.Mainnet,
    UNI_ADDRESSES[UniverseChainId.Mainnet] as string,
    18,
    'UNI',
    'Uniswap',
  ),
  [UniverseChainId.Goerli]: new Token(
    UniverseChainId.Goerli,
    UNI_ADDRESSES[UniverseChainId.Goerli] as string,
    18,
    'UNI',
    'Uniswap',
  ),
}

/** USDTX (OFT wrapper of USDT) by chainId — single source of truth, consumed by apps/web crossChain constants. */
export const USDTX: Record<number, Token> = {
  [UniverseChainId.Mainnet]: USDTX_MAINNET,
  [UniverseChainId.Base]: USDTX_BASE,
  [UniverseChainId.ArbitrumOne]: USDTX_ARBITRUM_ONE,
  [UniverseChainId.Avalanche]: USDTX_AVALANCHE,
  [UniverseChainId.Sepolia]: USDTX_SEPOLIA,
  [UniverseChainId.JocTestnet]: USDTX_JOC_TESTNET,
  [UniverseChainId.JocMainnet]: USDTX_JOC_MAINNET,
  [UniverseChainId.ArbitrumSepolia]: USDTX_ARBITRUM_SEPOLIA,
  [UniverseChainId.Base_Sepolia]: USDTX_BASE_SEPOLIA,
  [UniverseChainId.Avalanche_Fuji]: USDTX_AVALANCHE_FUJI,
}

/** USDCX (OFT wrapper of USDC) by chainId — single source of truth, consumed by apps/web crossChain constants. */
export const USDCX: Record<number, Token> = {
  [UniverseChainId.Mainnet]: USDCX_MAINNET,
  [UniverseChainId.Base]: USDCX_BASE,
  [UniverseChainId.ArbitrumOne]: USDCX_ARBITRUM_ONE,
  [UniverseChainId.Avalanche]: USDCX_AVALANCHE,
  [UniverseChainId.JocTestnet]: USDCX_JOC_TESTNET,
  [UniverseChainId.Sepolia]: USDCX_SEPOLIA,
  [UniverseChainId.JocMainnet]: USDCX_JOC_MAINNET,
  [UniverseChainId.ArbitrumSepolia]: USDCX_ARBITRUM_SEPOLIA,
  [UniverseChainId.Base_Sepolia]: USDCX_BASE_SEPOLIA,
  [UniverseChainId.Avalanche_Fuji]: USDCX_AVALANCHE_FUJI,
}

/** JOCX (OFT/native-JOC bridge token) by chainId — single source of truth, consumed by apps/web crossChain constants. */
export const JOCX: Record<number, Token> = {
  [UniverseChainId.Mainnet]: JOCX_MAINNET,
  [UniverseChainId.Base]: JOCX_BASE,
  [UniverseChainId.ArbitrumOne]: JOCX_ARBITRUM_ONE,
  [UniverseChainId.Avalanche]: JOCX_AVALANCHE,
  [UniverseChainId.Sepolia]: JOCX_SEPOLIA,
  [UniverseChainId.Avalanche_Fuji]: JOCX_AVALANCHE_FUJI,
  [UniverseChainId.Base_Sepolia]: JOCX_BASE_SEPOLIA,
  [UniverseChainId.ArbitrumSepolia]: JOCX_ARBITRUM_SEPOLIA,
}

