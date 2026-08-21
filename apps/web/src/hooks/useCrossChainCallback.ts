import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { useAccount } from 'hooks/useAccount'
import { useAppDispatch } from 'state/hooks'
import { addTransaction, markCrossChainSwapBridgePending } from 'state/transactions/reducer'
import { TransactionType } from 'state/transactions/types'
import { currencyId } from 'utils/currencyId'
import {
  XCHAINSENDER_ADDRESS,
  XCHAINSENDER_NATIVE_SENTINEL,
  OFT_TOKEN_SYMBOLS,
  getOftAddress,
  isStablecoinToOftPair,
  DEFAULT_FEE_BUFFER_MULTIPLIER,
} from 'lib/crossChain/constants'

import { UniverseChainId } from 'uniswap/src/types/chains'

import { CrossChainRoute, IntermediateToken } from 'lib/crossChain/types'
import { ClassicTrade } from 'state/routing/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfig } from 'wagmi'
import { switchChain, writeContract, simulateContract, waitForTransactionReceipt, getPublicClient } from 'wagmi/actions'

import XChainSenderAbi from 'lib/crossChain/abis/xChainSender.json'

import { extractAcrossDepositId } from 'lib/crossChain/bridge/across'

import {
  addressToBytes32,
  toBridgeAddress,
  buildSwapCommands,
  buildConvertCommands,
  buildBridgeCommands,
  type PcsCommand,
} from 'lib/crossChain/commandBuilders'

function isOftSymbol(symbol?: string): boolean {
  return OFT_TOKEN_SYMBOLS.has((symbol ?? '').toUpperCase())
}

export type BridgeStatus = 'idle' | 'pending' | 'success' | 'error'

export interface BridgeCallbackResult {
  execute: (permit2Data?: `0x${string}`) => Promise<`0x${string}` | undefined>
  status: BridgeStatus
  txHash: `0x${string}` | undefined
  error: Error | undefined
  reset: () => void
}

/** Output of one leg (swap or bridge) - commands get concatenated by execute() in step order. */
interface StagePlan {
  commands: PcsCommand[]
  value?: bigint
  bridgeProtocol?: 'lz' | 'across'
  /** true if this leg minted/converted the input into a different on-chain token (affects tx type) */
  isCrossChainSwap?: boolean
}

/** Bridge leg's input token, when it isn't simply inputCurrency (e.g. swap leg's output). */
interface BridgeSource {
  tokenAddr: `0x${string}`
  symbol?: string
  amount: bigint
}

/**
 * Dst-chain swap embedded in the bridge's recipientMessage — used for BRIDGE_SWAP (leg2) and
 * SWAP_BRIDGE_SWAP (leg3). `intermediateToken` is what the bridge itself delivers on dst chain
 * (route.intermediateToken / intermediateTokenDst); `poolFee` comes from leg2Trade's SOR quote.
 */
interface DstSwapTarget {
  intermediateToken: IntermediateToken
  poolFee: number
}

export function useCrossChainCallback(
  route: CrossChainRoute | null | undefined,
  inputCurrency: Currency | null | undefined,
  outputCurrency: Currency | null | undefined,
  inputAmount: CurrencyAmount<Currency> | undefined,
  outputAmount: CurrencyAmount<Currency> | undefined,
  leg1Trade: ClassicTrade | undefined,
  externalPermit2Data?: `0x${string}`,
  /** SOR quote for the dst-chain swap leg (BRIDGE_SWAP's leg2, SWAP_BRIDGE_SWAP's leg3) —
   * only its pool fee is used, to build the embedded SWAP command's UR calldata. */
  leg2Trade?: ClassicTrade,
): BridgeCallbackResult {
  const { address: account, chainId } = useAccount()
  const wagmiConfig = useConfig()
  const dispatch = useAppDispatch()

  // Ref so callbacks always read latest permit2Data without stale closure
  const permit2DataRef = useRef(externalPermit2Data)
  useEffect(() => { permit2DataRef.current = externalPermit2Data }, [externalPermit2Data])

  const [status, setStatus] = useState<BridgeStatus>('idle')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [error, setError] = useState<Error | undefined>()

  const reset = useCallback(() => {
    setStatus('idle')
    setTxHash(undefined)
    setError(undefined)
  }, [])

  /** src-chain SWAP: inputCurrency -> targetToken. Used by SWAP_BRIDGE (target=route.intermediateToken)
   * and SWAP_BRIDGE_SWAP (target=route.intermediateTokenSrc). */
  const planSwap = useCallback(async (
    src: number, rawAmount: bigint, xChainSenderAddr: `0x${string}`, targetToken: IntermediateToken,
  ): Promise<{ stage: StagePlan; bridgeSource: BridgeSource }> => {
    if (!inputCurrency || !outputCurrency) throw new Error('Swap: missing required params')
    if (!inputCurrency.isToken) throw new Error('Swap: inputCurrency must be a token (not native)')

    const inputTokenAddr = inputCurrency.address as `0x${string}`
    const targetTokenAddr = targetToken.address as `0x${string}`
    // Pool fee from leg1 swap quote (Trade.routes[0].pools[0].fee); fallback 500 (0.05%)
    const poolFee: number = (leg1Trade?.routes?.[0] as any)?.pools?.[0]?.fee ?? 500

    const commands = buildSwapCommands({
      inputTokenAddr, rawAmount, xChainSenderAddr, outputTokenAddr: targetTokenAddr, poolFee, srcChainId: src,
    })

    // Bridge protocol determined by the target token: OFT (JOCX/USDCX/USDTX) -> LayerZero,
    // everything else (e.g. USDC) -> Across Protocol.
    let bridgeAmount = rawAmount
    if (!isOftSymbol(targetToken.symbol)) {
      if (!leg1Trade) throw new Error('Swap (Across leg): leg1Trade required to estimate bridge input amount')
      // Amount entering the bridge = leg1 swap output, with 1% slippage buffer (matches e2e
      // SLIPPAGE_BPS). Across API needs the real post-swap amount - Dispatcher overrides
      // on-chain with actual balance anyway.
      const leg1OutRaw = BigInt(leg1Trade.outputAmount.quotient.toString())
      bridgeAmount = (leg1OutRaw * 9900n) / 10000n
    }

    return {
      stage: { commands },
      bridgeSource: { tokenAddr: targetTokenAddr, symbol: targetToken.symbol, amount: bridgeAmount },
    }
  }, [inputCurrency, outputCurrency, leg1Trade])

  const planBridge = useCallback(async (
    src: number, dst: number, rawAmount: bigint, xChainSenderAddr: `0x${string}`,
    source?: BridgeSource, dstSwapTarget?: DstSwapTarget,
  ): Promise<StagePlan> => {
    if (!inputCurrency || !outputCurrency || !account) throw new Error('Bridge: missing required params')

    if (!source && !dstSwapTarget && isStablecoinToOftPair(inputCurrency, outputCurrency)) {
      if (!inputCurrency.isToken) throw new Error('Bridge: inputCurrency must be a token (not native)')
      const underlyingAddr = inputCurrency.address as `0x${string}`
      const oftAddr = getOftAddress(outputCurrency.symbol as string, src)
      if (!oftAddr) throw new Error(`Bridge: ${outputCurrency.symbol} not deployed on chain ${src}`)

      const convertCommands = await buildConvertCommands({ underlyingAddr, oftAddr, xChainSenderAddr, wagmiConfig })
      const { commands: bridgeCommands, value } = await buildBridgeCommands({
        protocol: 'lz', account, srcChainId: src, dstChainId: dst,
        bridgeTokenAddr: oftAddr, bridgeInputAmount: rawAmount, wagmiConfig,
      })
      return {
        commands: [...convertCommands, ...bridgeCommands], value,
        bridgeProtocol: 'lz', isCrossChainSwap: true,
      }
    }

    const tokenSymbol = source?.symbol ?? inputCurrency.symbol
    const bridgeAmount = source?.amount ?? rawAmount
    // What the bridge itself delivers on dst chain: dstSwapTarget.intermediateToken when a
    // dst-chain swap follows (BRIDGE_SWAP/SWAP_BRIDGE_SWAP), else the final outputCurrency.
    const bridgeOutputSymbol = dstSwapTarget ? dstSwapTarget.intermediateToken.symbol : outputCurrency.symbol
    const outputTokenAddr = (
      dstSwapTarget ? dstSwapTarget.intermediateToken.address : toBridgeAddress(outputCurrency)
    ) as `0x${string}`
    const protocol: 'lz' | 'across' = isOftSymbol(tokenSymbol) || isOftSymbol(bridgeOutputSymbol) ? 'lz' : 'across'
    // Native input: LZAdapter/XChainSender expect the contract's own zero-address sentinel
    // (Constants.ETH), NOT Across's WETH-wrap convention — see x-chain-sender e2e/layerzero/
    // japan-open-chain-testnet/joc/bridge.e2e.ts. Across still needs the WETH address
    // (toBridgeAddress) since its SpokePool wraps/unwraps ETH itself.
    const tokenAddr = source?.tokenAddr ?? (
      inputCurrency.isNative
        ? (protocol === 'lz' ? XCHAINSENDER_NATIVE_SENTINEL as `0x${string}` : (toBridgeAddress(inputCurrency) as `0x${string}`))
        : (inputCurrency.address as `0x${string}`)
    )

    // Burn-to-origin (OFT→underlying, e.g. USDTX→USDT): route.unwrapToOrigin set by routeEngine
    // (isOftToStablecoinPair) — dst chain redeems the OFT's own underlying ERC20 on arrival.
    // Doesn't apply when a dst-chain swap follows (bridge lands an intermediate token, not the
    // final one directly).
    const unwrapToOrigin = !source && !dstSwapTarget && route?.unwrapToOrigin === true

    const dstSwap = dstSwapTarget
      ? {
          outputCurrencyAddr: toBridgeAddress(outputCurrency) as `0x${string}`,
          poolFee: dstSwapTarget.poolFee,
          account,
          dstChainId: dst,
        }
      : undefined

    const { commands, value } = await buildBridgeCommands({
      protocol, account, srcChainId: src, dstChainId: dst,
      bridgeTokenAddr: tokenAddr, bridgeInputAmount: bridgeAmount,
      outputTokenAddr, unwrapToOrigin, isNativeInput: !source && inputCurrency.isNative, wagmiConfig,
      dstSwap,
    })
    return { commands, value, bridgeProtocol: protocol, isCrossChainSwap: !!dstSwapTarget }
  }, [route, inputCurrency, outputCurrency, account, wagmiConfig])


  const execute = useCallback(async (inlinePermit2Data?: `0x${string}`): Promise<`0x${string}` | undefined> => {
    if (!route || !inputCurrency || !outputCurrency || !inputAmount || !account) {
      throw new Error('execute: missing required params')
    }
    const permit2Data = inlinePermit2Data ?? permit2DataRef.current
    // Native input bridges via msg.value (no transferFrom) — Permit2 doesn't apply, so
    // permit2Data is never signed for it (see useCrossChainConfirmModalState's needsPermit
    // guard). Only ERC20 input actually requires it.
    if (!inputCurrency.isNative && !permit2Data) {
      throw new Error('execute: permit2Data missing - sign permit first')
    }


    const src = inputCurrency.chainId
    const dst = outputCurrency.chainId
    const rawAmount = BigInt(inputAmount.quotient.toString())

    const xChainSenderAddr = XCHAINSENDER_ADDRESS[src]
    if (!xChainSenderAddr) throw new Error(`XChainSender not deployed on chain ${src}`)

    // Pool fee for the dst-chain swap leg (BRIDGE_SWAP's leg2, SWAP_BRIDGE_SWAP's leg3).
    const leg2PoolFee: number = (leg2Trade?.routes?.[0] as any)?.pools?.[0]?.fee ?? 500

    setStatus('pending')
    setError(undefined)

    try {
      if (chainId !== src) {
        await switchChain(wagmiConfig, { chainId: src })
      }

      const commands: PcsCommand[] = []
      let value = 0n
      let bridgeProtocol: 'lz' | 'across' = 'across'
      let txType: TransactionType.BRIDGE | TransactionType.CROSS_CHAIN_SWAP = TransactionType.BRIDGE

      switch (route.routeCase) {
        case 'BRIDGE_ONLY': {
          const stage = await planBridge(src, dst, rawAmount, xChainSenderAddr)
          commands.push(...stage.commands)
          value = stage.value ?? 0n
          bridgeProtocol = stage.bridgeProtocol ?? 'across'
          if (stage.isCrossChainSwap) txType = TransactionType.CROSS_CHAIN_SWAP
          break
        }

        case 'SWAP_BRIDGE': {
          if (!route.intermediateToken) throw new Error('SWAP_BRIDGE: route.intermediateToken missing')
          const { stage: swapStage, bridgeSource } = await planSwap(src, rawAmount, xChainSenderAddr, route.intermediateToken)
          commands.push(...swapStage.commands)
          txType = TransactionType.CROSS_CHAIN_SWAP

          const bridgeStage = await planBridge(src, dst, rawAmount, xChainSenderAddr, bridgeSource)
          commands.push(...bridgeStage.commands)
          value = bridgeStage.value ?? 0n
          bridgeProtocol = bridgeStage.bridgeProtocol ?? 'across'
          break
        }

        case 'BRIDGE_SWAP': {
          if (!route.intermediateToken) throw new Error('BRIDGE_SWAP: route.intermediateToken missing')
          const bridgeStage = await planBridge(src, dst, rawAmount, xChainSenderAddr, undefined, {
            intermediateToken: route.intermediateToken,
            poolFee: leg2PoolFee,
          })
          commands.push(...bridgeStage.commands)
          value = bridgeStage.value ?? 0n
          bridgeProtocol = bridgeStage.bridgeProtocol ?? 'across'
          txType = TransactionType.CROSS_CHAIN_SWAP
          break
        }

        case 'SWAP_BRIDGE_SWAP': {
          if (!route.intermediateTokenSrc || !route.intermediateTokenDst) {
            throw new Error('SWAP_BRIDGE_SWAP: intermediateTokenSrc/Dst missing')
          }
          const { stage: swapStage, bridgeSource } = await planSwap(src, rawAmount, xChainSenderAddr, route.intermediateTokenSrc)
          commands.push(...swapStage.commands)
          txType = TransactionType.CROSS_CHAIN_SWAP

          const bridgeStage = await planBridge(src, dst, rawAmount, xChainSenderAddr, bridgeSource, {
            intermediateToken: route.intermediateTokenDst,
            poolFee: leg2PoolFee,
          })
          commands.push(...bridgeStage.commands)
          value = bridgeStage.value ?? 0n
          bridgeProtocol = bridgeStage.bridgeProtocol ?? 'across'
          break
        }

        default:
          throw new Error(`Unsupported routeCase: ${route.routeCase}`)
      }

      if (commands.length === 0) {
        throw new Error(
          `Unsupported route: steps=[${route.steps.join(',')}] - ${inputCurrency.symbol} (chain ${inputCurrency.chainId}) -> ${outputCurrency.symbol} (chain ${outputCurrency.chainId})`,
        )
      }

      // Native input: top-level inputToken decides transferFrom-vs-msg.value inside
      // XChainSender.send() itself — must ALWAYS be the contract's own native sentinel
      // (0x0) regardless of bridge protocol. Using toBridgeAddress (WETH) here made the
      // contract treat native ETH input as an ERC20 and attempt transferFrom, reverting
      // with TRANSFER_FROM_FAILED for Across routes. toBridgeAddress is still correct
      // *inside* planBridge/buildBridgeCommands (protocol-specific bridgeTokenAddr passed
      // to AcrossAdapter) — that's a different field, don't touch it.
      const inputToken = inputCurrency.isNative
        ? (XCHAINSENDER_NATIVE_SENTINEL as `0x${string}`)
        : (inputCurrency.address as `0x${string}`)

      // Native input: XChainSender.send() requires order.inputAmount === msg.value exactly
      // (see XChainSender.sol: `if (msg.value != order.inputAmount) revert InsufficientSendBalance()`).
      // `value` here already includes bridge fee (LZ nativeFee) on top of rawAmount, so
      // inputAmount must match that, not just rawAmount. ERC20 input still uses rawAmount
      // (transferFrom amount, unrelated to msg.value).
      const sendArgs = [{
        inputToken: addressToBytes32(inputToken),
        inputAmount: inputCurrency.isNative ? value : rawAmount,
        commands,
        permit2Data: permit2Data ?? '0x', // native input: no permit2Data signed, contract ignores it
      }]




      let feeOverrides: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {}
      try {
        const publicClient = getPublicClient(wagmiConfig, { chainId: src })
        if (src === UniverseChainId.ArbitrumSepolia) {
          const block = await publicClient!.request({
            method: 'eth_getBlockByNumber',
            params: ['latest', false],
          }) as { baseFeePerGas?: `0x${string}` }
          const baseFee = BigInt(block.baseFeePerGas ?? '0x0')
          const maxPriorityFeePerGas = 1_000_000n // 0.001 gwei floor
          feeOverrides = { maxFeePerGas: baseFee * 4n + maxPriorityFeePerGas, maxPriorityFeePerGas }
        } else {
          const { maxFeePerGas: estMaxFee, maxPriorityFeePerGas: estPriority } =
            await publicClient!.estimateFeesPerGas()
          const maxPriorityFeePerGas = estPriority && estPriority > 0n ? estPriority : 1n
          const maxFeePerGas = (estMaxFee * DEFAULT_FEE_BUFFER_MULTIPLIER) / 10n + maxPriorityFeePerGas
          feeOverrides = { maxFeePerGas, maxPriorityFeePerGas }
        }
      } catch {
        // ignore - let wallet estimate as before
      }

      // RPC (api.gu.net) defaults eth_call gas to 600_000_000 when `gas` isn't supplied,
      // then checks balance as gas*gasFee+value against that phantom limit — e.g.
      // 600M * ~1.87 gwei ≈ 1.12 ETH, way more than the tx actually costs. Estimate real
      // gas first so simulate/send use an honest limit instead of the RPC's default.
      const publicClientForGas = getPublicClient(wagmiConfig, { chainId: src })
      let gas: bigint | undefined
      try {
        const estimated = await publicClientForGas!.estimateContractGas({
          address: xChainSenderAddr,
          abi: XChainSenderAbi,
          functionName: 'send',
          args: sendArgs,
          value,
          account,
        })
        gas = (estimated * 130n) / 100n // 30% buffer
      } catch {
        gas = 3_000_000n // fallback: cross-chain send (swap+bridge commands) ceiling
      }

      const hash = await writeContract(wagmiConfig, {
        address: xChainSenderAddr,
        abi: XChainSenderAbi,
        functionName: 'send',
        args: sendArgs,
        value,
        gas,
        ...feeOverrides,
      })
      // console.log('Start simulateContract result')
      // const simulation = await simulateContract(wagmiConfig, {
      //   address: xChainSenderAddr,
      //   abi: XChainSenderAbi,
      //   functionName: 'send',
      //   args: sendArgs,
      //   value,
      //   gas,
      //   ...feeOverrides,
      // })
      // console.log('[debug] simulateContract result', simulation)
      // const hash = '0x0' as `0x${string}` // DEBUG placeholder, not a real tx


      dispatch(
        addTransaction({
          hash,
          from: account,
          chainId: src,
          info: {
            type: txType,
            inputCurrencyId: currencyId(inputCurrency),
            outputCurrencyId: currencyId(outputCurrency),
            inputCurrencyAmountRaw: inputAmount.quotient.toString(),
            expectedOutputCurrencyAmountRaw: outputAmount?.quotient.toString() || inputAmount.quotient.toString(),
            srcChainId: src,
            dstChainId: dst,
            bridgeProtocol,
          },
        }),
      )
      setTxHash(hash)
      setStatus('success')

      // Across: fetch depositId (FundsDeposited event) to enable GET /deposit/status polling —
      // best-effort, must never affect the tx we already reported above.
      if (bridgeProtocol === 'across') {
        try {
          const receipt = await waitForTransactionReceipt(wagmiConfig, { hash })
          const depositId = extractAcrossDepositId(receipt.logs)
          if (depositId) {
            dispatch(markCrossChainSwapBridgePending({ chainId: src, hash, depositId }))
          }
        } catch {
          // ignore - depositId polling degrades gracefully without it
        }
      }

      return hash
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      setStatus('error')
      throw e
    }
  }, [
    route, inputCurrency, outputCurrency, inputAmount, outputAmount, account,
    chainId, wagmiConfig, dispatch, planSwap, planBridge, leg2Trade,
  ])

  return { execute, status, txHash, error, reset }
}
