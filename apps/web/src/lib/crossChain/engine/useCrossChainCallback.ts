import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { useAccount } from 'hooks/useAccount'
import { useAppDispatch } from 'state/hooks'
import { addTransaction, markCrossChainSwapBridgePending } from 'state/transactions/reducer'
import { TransactionType } from 'state/transactions/types'
import { currencyId } from 'utils/currencyId'
import {
  XCHAINSENDER_ADDRESS,
  XCHAINSENDER_NATIVE_SENTINEL,
  DEFAULT_FEE_BUFFER_MULTIPLIER,
} from 'lib/crossChain/constants'

import { UniverseChainId } from 'uniswap/src/types/chains'

import { CrossChainRoute, IntermediateToken } from 'lib/crossChain/types'
import { ClassicTrade } from 'state/routing/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfig } from 'wagmi'
import { switchChain, writeContract, waitForTransactionReceipt, getPublicClient } from 'wagmi/actions'

import XChainSenderAbi from 'lib/crossChain/abis/xChainSender.json'

import type { BridgeProviderId } from 'lib/crossChain/bridge'
import { findBridgeProvider, getBridgeProvider } from 'lib/crossChain/engine/registry'

import {
  addressToBytes32,
  toBridgeAddress,
  buildSwapCommands,
  type PcsCommand,
} from 'lib/crossChain/commandBuilders'

import type { AggregatorExecution as BridgeCallbackResult, ExecuteStatus as BridgeStatus } from 'lib/crossChain/aggregator/types'

/** Output of one leg (swap or bridge) - commands get concatenated by execute() in step order. */
interface StagePlan {
  commands: PcsCommand[]
  value?: bigint
  bridgeProtocol?: BridgeProviderId
  /** true if this leg minted/converted the input into a different on-chain token (affects tx type) */
  isCrossChainSwap?: boolean
}

/** Bridge leg's input token, when it isn't simply inputCurrency (e.g. swap leg's output). */
interface BridgeSource {
  tokenAddr: `0x${string}`
  symbol?: string
  /** Expected bridge input (swap output minus slippage) — for bridges that encode a real amount. */
  estimatedAmount?: bigint
}

/**
 * Dst-chain swap embedded in the bridge's recipientMessage — used for BRIDGE_SWAP (leg2) and
 * SWAP_BRIDGE_SWAP (leg3). `intermediateToken` is what the bridge itself delivers on dst chain
 * (route.intermediateToken / intermediateTokenDst); `trade` is leg2Trade's SOR quote.
 */
interface DstSwapTarget {
  intermediateToken: IntermediateToken
  trade: ClassicTrade
  slippageTolerance: Percent
}

const toBigInt = (amount: CurrencyAmount<Currency>): bigint => BigInt(amount.quotient.toString())

export function useCrossChainCallback(
  route: CrossChainRoute | null | undefined,
  inputCurrency: Currency | null | undefined,
  outputCurrency: Currency | null | undefined,
  inputAmount: CurrencyAmount<Currency> | undefined,
  outputAmount: CurrencyAmount<Currency> | undefined,
  leg1Trade: ClassicTrade | undefined,
  externalPermit2Data?: `0x${string}`,
  /** SOR quote for the dst-chain swap leg (BRIDGE_SWAP's leg2, SWAP_BRIDGE_SWAP's leg3) —
   * its route path + min output build the embedded SWAP command's UR calldata. */
  leg2Trade?: ClassicTrade,
  /** User slippage tolerance — sets amountOutMin on every swap leg. */
  allowedSlippage?: Percent,
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

    if (!leg1Trade || !allowedSlippage) throw new Error('Swap: leg1Trade/allowedSlippage missing')

    const inputTokenAddr = inputCurrency.address as `0x${string}`
    const targetTokenAddr = targetToken.address as `0x${string}`
    // Min swap output = also the amount entering the bridge. Quote-based bridges (Across) need it;
    // Dispatcher overrides on-chain with the actual balance anyway.
    const amountOutMin = toBigInt(leg1Trade.minimumAmountOut(allowedSlippage))

    const commands = buildSwapCommands({
      inputTokenAddr, rawAmount, xChainSenderAddr, trade: leg1Trade, slippageTolerance: allowedSlippage, srcChainId: src,
    })
    const estimatedAmount = amountOutMin

    return {
      stage: { commands },
      bridgeSource: { tokenAddr: targetTokenAddr, symbol: targetToken.symbol, estimatedAmount },
    }
  }, [inputCurrency, outputCurrency, leg1Trade, allowedSlippage])

  const planBridge = useCallback(async (
    src: number, dst: number, rawAmount: bigint,
    source?: BridgeSource, dstSwapTarget?: DstSwapTarget,
  ): Promise<StagePlan & { bridgeProtocol: BridgeProviderId }> => {
    if (!inputCurrency || !outputCurrency || !account) throw new Error('Bridge: missing required params')

    // What the bridge itself delivers on dst chain: dstSwapTarget.intermediateToken when a
    // dst-chain swap follows (BRIDGE_SWAP/SWAP_BRIDGE_SWAP), else the final outputCurrency.
    const bridgeOutputSymbol = dstSwapTarget ? dstSwapTarget.intermediateToken.symbol : outputCurrency.symbol
    const outputTokenAddr = (
      dstSwapTarget ? dstSwapTarget.intermediateToken.address : toBridgeAddress(outputCurrency)
    ) as `0x${string}`
    const provider = findBridgeProvider(
      { symbol: source?.symbol ?? inputCurrency.symbol, chainId: src },
      { symbol: bridgeOutputSymbol, chainId: dst },
    )
    // After a src swap, bridge input = leg1 min output (also the dst swap's worst-case arrival).
    if (source && source.estimatedAmount === undefined && !provider.usesContractBalance) {
      throw new Error(`Swap (${provider.name} leg): leg1Trade required to estimate bridge input amount`)
    }
    const bridgeAmount = source?.estimatedAmount ?? rawAmount
    // Native input passed as wrapped address + isNativeInput; each provider maps it to its own sentinel.
    const tokenAddr = source?.tokenAddr ?? (toBridgeAddress(inputCurrency) as `0x${string}`)

    // Burn-to-origin (OFT→underlying, e.g. USDTX→USDT): route.unwrapToOrigin set by routeEngine
    // (isOftToStablecoinPair) — dst chain redeems the OFT's own underlying ERC20 on arrival.
    // Doesn't apply when a dst-chain swap follows (bridge lands an intermediate token, not the
    // final one directly).
    const unwrapToOrigin = !source && !dstSwapTarget && route?.unwrapToOrigin === true

    const dstSwap = dstSwapTarget
      ? {
          trade: dstSwapTarget.trade,
          slippageTolerance: dstSwapTarget.slippageTolerance,
          account,
          dstChainId: dst,
        }
      : undefined

    // Provider may prepend its own token conversion (LZ: USDT -> USDTX mint) and flag isCrossChainSwap.
    const { commands, value, isCrossChainSwap } = await provider.buildCommands({
      account, srcChainId: src, dstChainId: dst,
      bridgeTokenAddr: tokenAddr, bridgeInputAmount: bridgeAmount,
      outputTokenAddr, unwrapToOrigin, isNativeInput: !source && inputCurrency.isNative, wagmiConfig,
      dstSwap,
    })
    return { commands, value, bridgeProtocol: provider.id, isCrossChainSwap: !!dstSwapTarget || !!isCrossChainSwap }
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

    // Dst-chain swap leg (BRIDGE_SWAP's leg2, SWAP_BRIDGE_SWAP's leg3): path + slippage-protected min out.
    const dstSwapFor = (intermediateToken: IntermediateToken): DstSwapTarget => {
      if (!leg2Trade || !allowedSlippage) throw new Error('Dst swap: leg2Trade/allowedSlippage missing')
      return {
        intermediateToken,
        trade: leg2Trade,
        slippageTolerance: allowedSlippage,
      }
    }

    setStatus('pending')
    setError(undefined)

    try {
      if (chainId !== src) {
        await switchChain(wagmiConfig, { chainId: src })
      }

      const commands: PcsCommand[] = []
      let value = 0n
      let bridgeProtocol: BridgeProviderId
      let txType: TransactionType.BRIDGE | TransactionType.CROSS_CHAIN_SWAP = TransactionType.BRIDGE

      switch (route.routeCase) {
        case 'BRIDGE_ONLY': {
          const stage = await planBridge(src, dst, rawAmount)
          commands.push(...stage.commands)
          value = stage.value ?? 0n
          bridgeProtocol = stage.bridgeProtocol
          if (stage.isCrossChainSwap) txType = TransactionType.CROSS_CHAIN_SWAP
          break
        }

        case 'SWAP_BRIDGE': {
          if (!route.intermediateToken) throw new Error('SWAP_BRIDGE: route.intermediateToken missing')
          const { stage: swapStage, bridgeSource } = await planSwap(src, rawAmount, xChainSenderAddr, route.intermediateToken)
          commands.push(...swapStage.commands)
          txType = TransactionType.CROSS_CHAIN_SWAP

          const bridgeStage = await planBridge(src, dst, rawAmount, bridgeSource)
          commands.push(...bridgeStage.commands)
          value = bridgeStage.value ?? 0n
          bridgeProtocol = bridgeStage.bridgeProtocol
          break
        }

        case 'BRIDGE_SWAP': {
          if (!route.intermediateToken) throw new Error('BRIDGE_SWAP: route.intermediateToken missing')
          const bridgeStage = await planBridge(src, dst, rawAmount, undefined, dstSwapFor(route.intermediateToken))
          commands.push(...bridgeStage.commands)
          value = bridgeStage.value ?? 0n
          bridgeProtocol = bridgeStage.bridgeProtocol
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

          const bridgeStage = await planBridge(src, dst, rawAmount, bridgeSource, dstSwapFor(route.intermediateTokenDst))
          commands.push(...bridgeStage.commands)
          value = bridgeStage.value ?? 0n
          bridgeProtocol = bridgeStage.bridgeProtocol
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
      // *inside* planBridge/provider.buildCommands (provider-specific bridgeTokenAddr) —
      // that's a different field, don't touch it.
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

      // Providers needing a depositId for completion polling (Across) — best-effort,
      // must never affect the tx we already reported above.
      const getDepositId = getBridgeProvider(bridgeProtocol).getDepositId
      if (getDepositId) {
        try {
          const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: src })
          const depositId = getDepositId(receipt.logs)
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
    chainId, wagmiConfig, dispatch, planSwap, planBridge, leg2Trade, allowedSlippage,
  ])

  return { execute, status, txHash, error, reset }
}
