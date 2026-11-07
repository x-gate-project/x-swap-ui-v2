import { Address, encodeFunctionData, erc20Abi, maxUint256, parseAbi } from 'viem'

import type {
  XSwapChain,
  XSwapLeg,
  XSwapOrder,
  XSwapOrderStatus,
  XSwapPermitTypedData,
  XSwapQuote,
  XSwapQuoteResponse,
  XSwapRoutesResponse,
  XSwapToken,
  XSwapTx,
} from '../../src/state/xswap/types'
import { PERMIT2_ADDRESS } from './mockChain'

export const SEPOLIA = 11155111
export const ARB_SEPOLIA = 421614
const JOC_TESTNET = 10081

export const NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000'
export const ACCOUNT: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

// Real testnet addresses, as in the component tests (XSwapRouteLegs.test.tsx).
const WETH_SEPOLIA = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
export const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const USDT_SEPOLIA = '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0'
export const USDC_ARB = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
const JOCX_ARB = '0xB1660F8CDbf2102Ac74C6CD6d7CD6A65E481e5fe'
const WJOC = '0x8B85219c0767Ce4FA5ae5944d71aB4a3De27090d'
const USDTX_JOC = '0x382eb09D8cE59968683001947EF04cB34f7A180E'
const USDCX_JOC = '0x367f476c9B5fA1e64F3d7EE19c3E4E2f76D42200'

/** Deposit targets: the bridge's spoke pool for cross-chain routes, the x-swap router for same-chain ones. */
export const SPOKE_POOL = '0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662'
export const XSWAP_ROUTER = '0x4444444444444444444444444444444444444444'

export const CHAINS: XSwapChain[] = [
  { chainId: SEPOLIA, name: 'Sepolia', nativeSymbol: 'ETH', wrappedNative: WETH_SEPOLIA },
  {
    chainId: ARB_SEPOLIA,
    name: 'Arbitrum Sepolia',
    nativeSymbol: 'ETH',
    wrappedNative: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
  },
  { chainId: JOC_TESTNET, name: 'JOC Testnet', nativeSymbol: 'JOC', wrappedNative: WJOC },
]

const token = (chainId: number, address: string, symbol: string, decimals: number): XSwapToken => ({
  chainId,
  address,
  symbol,
  decimals,
  class: 'native-side',
  available: true,
})

export const TOKENS = {
  ethSepolia: token(SEPOLIA, NATIVE_ADDRESS, 'ETH', 18),
  usdcSepolia: token(SEPOLIA, USDC_SEPOLIA, 'USDC', 6),
  usdtSepolia: token(SEPOLIA, USDT_SEPOLIA, 'USDT', 6),
  usdcArb: token(ARB_SEPOLIA, USDC_ARB, 'USDC', 6),
  jocxArb: token(ARB_SEPOLIA, JOCX_ARB, 'JOCX', 18),
  joc: token(JOC_TESTNET, NATIVE_ADDRESS, 'JOC', 18),
  usdtxJoc: token(JOC_TESTNET, USDTX_JOC, 'USDTX', 6),
  usdcxJoc: token(JOC_TESTNET, USDCX_JOC, 'USDCX', 6),
} satisfies Record<string, XSwapToken>

export const ALL_TOKENS = Object.values(TOKENS)

type Ref = { chainId: number; address: string }
const ref = (t: XSwapToken): Ref => ({ chainId: t.chainId, address: t.address })

/** `GET /routes`: every listed token on another chain is reachable, plus `local` on the same chain. */
export function allRoutes(tokenInChainId: number, tokenIn: string): XSwapRoutesResponse {
  return {
    tokenIn: { chainId: tokenInChainId, address: tokenIn },
    destinations: ALL_TOKENS.filter((t) => !(t.chainId === tokenInChainId && t.address === tokenIn)).map((t) => ({
      chainId: t.chainId,
      address: t.address,
      routeClass: t.chainId === tokenInChainId ? 'local' : 'evm-native',
      executable: true,
    })),
  }
}

// ---- txs ----

const approveTx = (tokenIn: Ref, spender: string, amount = maxUint256): XSwapTx => ({
  chainId: tokenIn.chainId,
  kind: 'approve',
  to: tokenIn.address,
  data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender as Address, amount] }),
  value: '0',
})

const permit2ApproveTx = (tokenIn: Ref, spender: string): XSwapTx => ({
  chainId: tokenIn.chainId,
  kind: 'permit2-approve',
  to: PERMIT2_ADDRESS,
  data: encodeFunctionData({
    abi: parseAbi(['function approve(address token, address spender, uint160 amount, uint48 expiration)']),
    functionName: 'approve',
    args: [tokenIn.address as Address, spender as Address, 2n ** 160n - 1n, 2 ** 48 - 1],
  }),
  value: '0',
})

const depositTx = (chainId: number, to: string, value = '0', data = '0xad5425c6'): XSwapTx => ({
  chainId,
  kind: 'deposit',
  to,
  data,
  value,
})

function permitTypedData(tokenIn: Ref, spender: string, amount: string): XSwapPermitTypedData {
  const inOneHour = Math.floor(Date.now() / 1000) + 3600
  return {
    domain: { name: 'Permit2', chainId: tokenIn.chainId, verifyingContract: PERMIT2_ADDRESS },
    types: {
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
    },
    primaryType: 'PermitSingle',
    message: {
      details: { token: tokenIn.address, amount, expiration: inOneHour, nonce: 0 },
      spender,
      sigDeadline: String(inOneHour),
    },
  }
}

// ---- quotes ----

let quoteSeq = 0
const nextQuoteId = () => `q-${++quoteSeq}`

/** Base quote: a valid, executable route that stays fresh for 2 minutes. */
function baseQuote(tokenIn: XSwapToken, tokenOut: XSwapToken, overrides: Partial<XSwapQuote>): XSwapQuote {
  return {
    quoteId: nextQuoteId(),
    provider: 'across',
    routing: 'BRIDGE',
    routeClass: 'evm-native',
    tokenIn: ref(tokenIn),
    tokenOut: ref(tokenOut),
    inputAmount: '100000000',
    outputAmount: '99500000',
    minOutputAmount: '99000000',
    priceImpactBps: 0,
    fees: { lp: '0', relayer: '500000', gas: '0', app: '0' },
    etaSec: 30,
    expiresAt: Date.now() + 120_000,
    executable: true,
    destSwap: false,
    shape: 'bridge',
    txs: [],
    score: 1,
    ...overrides,
  }
}

/** USDC on Sepolia → USDC on Arbitrum Sepolia over Across: approve the spoke pool, then deposit. */
export function xchainQuote(overrides: Partial<XSwapQuote> = {}): XSwapQuote {
  const tokenIn = TOKENS.usdcSepolia
  return baseQuote(tokenIn, TOKENS.usdcArb, {
    legs: [
      {
        type: 'bridge',
        provider: 'across',
        tokenInChainId: SEPOLIA,
        tokenOutChainId: ARB_SEPOLIA,
        tokenIn: USDC_SEPOLIA,
        tokenOut: USDC_ARB,
        expectedOut: '99500000',
        minOut: '99000000',
        nativeFee: '0',
      },
    ],
    txs: [approveTx(ref(tokenIn), SPOKE_POOL), depositTx(SEPOLIA, SPOKE_POOL)],
    ...overrides,
  })
}

/** The same bridge through Permit2: approve Permit2, sign a permit for the spoke pool, then deposit. */
export function xchainPermitQuote(overrides: Partial<XSwapQuote> = {}): XSwapQuote {
  const tokenIn = ref(TOKENS.usdcSepolia)
  return xchainQuote({
    txs: [approveTx(tokenIn, PERMIT2_ADDRESS), permit2ApproveTx(tokenIn, SPOKE_POOL), depositTx(SEPOLIA, SPOKE_POOL)],
    permit: permitTypedData(tokenIn, SPOKE_POOL, '100000000'),
    ...overrides,
  })
}

/** USDC → ETH on Sepolia through the x-swap router: approve Permit2, sign the permit, swap. */
export function localQuote(overrides: Partial<XSwapQuote> = {}): XSwapQuote {
  const tokenIn = ref(TOKENS.usdcSepolia)
  return baseQuote(TOKENS.usdcSepolia, TOKENS.ethSepolia, {
    provider: 'xswap',
    routing: 'SWAP',
    routeClass: 'local',
    shape: 'swap',
    outputAmount: '40000000000000000',
    minOutputAmount: '39800000000000000',
    fees: { lp: '300000', relayer: '0', gas: '0', app: '0' },
    etaSec: 15,
    legs: [
      {
        type: 'swap',
        chainId: SEPOLIA,
        tokenIn: USDC_SEPOLIA,
        tokenOut: WETH_SEPOLIA,
        amountIn: '100000000',
        expectedOut: '40000000000000000',
        minOut: '39800000000000000',
        venue: 'uniswap-v3',
        path: { tokens: [USDC_SEPOLIA, WETH_SEPOLIA], fees: [500] },
      },
    ],
    txs: [
      approveTx(tokenIn, PERMIT2_ADDRESS),
      permit2ApproveTx(tokenIn, XSWAP_ROUTER),
      depositTx(SEPOLIA, XSWAP_ROUTER),
    ],
    permit: permitTypedData(tokenIn, XSWAP_ROUTER, '100000000'),
    ...overrides,
  })
}

/** What `POST /quote/:id/permit` answers: the deposit alone, built from the signature. */
export function signedQuote(quote: XSwapQuote): XSwapQuote {
  const deposit = quote.txs.find((tx) => tx.kind === 'deposit') as XSwapTx
  return { ...quote, quoteId: `${quote.quoteId}-signed`, txs: [deposit], permit: undefined }
}

/** ETH on Sepolia → JOCX on Arbitrum Sepolia: Uniswap v3 → Across → Uniswap v2. */
const COMPOSITE_LEGS: XSwapLeg[] = [
  {
    type: 'swap',
    chainId: SEPOLIA,
    tokenIn: WETH_SEPOLIA,
    tokenOut: USDC_SEPOLIA,
    amountIn: '1000000000000000000',
    expectedOut: '2500000000',
    minOut: '2487500000',
    venue: 'uniswap-v3',
    path: { tokens: [WETH_SEPOLIA, USDC_SEPOLIA], fees: [500] },
  },
  {
    type: 'bridge',
    provider: 'across',
    tokenInChainId: SEPOLIA,
    tokenOutChainId: ARB_SEPOLIA,
    tokenIn: USDC_SEPOLIA,
    tokenOut: USDC_ARB,
    expectedOut: '2499000000',
    minOut: '2499000000',
    nativeFee: '0',
  },
  {
    type: 'swap',
    chainId: ARB_SEPOLIA,
    tokenIn: USDC_ARB,
    tokenOut: JOCX_ARB,
    amountIn: '2499000000',
    expectedOut: '5000000000000000000000',
    minOut: '4975000000000000000000',
    venue: 'uniswap-v2',
  },
]

export function compositeQuote(overrides: Partial<XSwapQuote> = {}): XSwapQuote {
  return baseQuote(TOKENS.ethSepolia, TOKENS.jocxArb, {
    provider: 'composite',
    routing: 'BRIDGE_SWAP',
    routeClass: 'composite',
    shape: 'swap-bridge-swap',
    inputAmount: '1000000000000000000',
    outputAmount: '5000000000000000000000',
    minOutputAmount: '4975000000000000000000',
    destSwap: true,
    legs: COMPOSITE_LEGS,
    txs: [depositTx(SEPOLIA, XSWAP_ROUTER, '1000000000000000000')],
    ...overrides,
  })
}

/** USDT on Sepolia → USDTX on JOC Testnet: X-Gate locks the real stable; the LayerZero fee rides on the deposit. */
export function jocEthStableQuote(overrides: Partial<XSwapQuote> = {}): XSwapQuote {
  const tokenIn = ref(TOKENS.usdtSepolia)
  const nativeFee = '2500000000000000'
  return baseQuote(TOKENS.usdtSepolia, TOKENS.usdtxJoc, {
    provider: 'xgate',
    routing: 'BRIDGE',
    routeClass: 'joc-eth-stable-in',
    inputAmount: '10000000',
    outputAmount: '10000000',
    minOutputAmount: '10000000',
    fees: { lp: '0', relayer: '0', gas: '0', app: '0' },
    legs: [
      {
        type: 'bridge',
        provider: 'xgate',
        tokenInChainId: SEPOLIA,
        tokenOutChainId: JOC_TESTNET,
        tokenIn: USDT_SEPOLIA,
        tokenOut: USDTX_JOC,
        expectedOut: '10000000',
        minOut: '10000000',
        nativeFee,
      },
    ],
    txs: [approveTx(tokenIn, XSWAP_ROUTER), depositTx(SEPOLIA, XSWAP_ROUTER, nativeFee)],
    ...overrides,
  })
}

export function quoteResponse(best: XSwapQuote, candidates: XSwapQuote[] = []): XSwapQuoteResponse {
  return { requestId: `req-${best.quoteId}`, routeClass: best.routeClass, best, candidates, rejected: [] }
}

// ---- orders ----

const STATE: Record<XSwapOrderStatus, XSwapOrder['state']> = {
  SUBMITTED: 'pending',
  DEPOSITED: 'pending',
  EXPIRED: 'pending',
  FILLED: 'success',
  FILLED_FALLBACK: 'success',
  FAILED_ORIGIN: 'failed',
  REFUNDED: 'refunded',
}

export function order(quote: XSwapQuote, txHash: string, status: XSwapOrderStatus = 'SUBMITTED'): XSwapOrder {
  const now = new Date().toISOString()
  return {
    id: `order-${quote.quoteId}`,
    quoteId: quote.quoteId,
    provider: quote.provider,
    routeClass: String(quote.routeClass),
    swapper: ACCOUNT,
    tokenIn: { ...quote.tokenIn, amount: quote.inputAmount },
    tokenOut: quote.tokenOut,
    outputAmount: quote.outputAmount,
    minOutputAmount: quote.minOutputAmount,
    actualOutputAmount: status === 'FILLED' ? quote.outputAmount : undefined,
    status,
    state: STATE[status],
    stuck: false,
    verified: true,
    originTxHash: txHash,
    fillTxHash: status === 'FILLED' ? `0x${'f'.repeat(64)}` : undefined,
    refundTxHash: status === 'REFUNDED' ? `0x${'e'.repeat(64)}` : undefined,
    fillDeadline: null,
    createdAt: now,
    updatedAt: now,
  }
}
