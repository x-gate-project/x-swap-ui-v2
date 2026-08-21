import {
  InterfaceElementName,
  InterfaceEventName,
  InterfaceSectionName,
  SwapEventName,
} from '@uniswap/analytics-events'
import { Currency, CurrencyAmount, Token } from '@uniswap/sdk-core'

import { UNIVERSAL_ROUTER_ADDRESS } from '@uniswap/universal-router-sdk'
import { useAccountDrawer } from 'components/AccountDrawer/MiniPortfolio/hooks'
import { ButtonError, ButtonLight, ButtonPrimary } from 'components/Button'
import { GrayCard } from 'components/Card'
import Column, { AutoColumn } from 'components/Column'
import { ConfirmCrossChainModal, ConfirmSwapModal } from 'components/ConfirmSwapModal'
import SwapCurrencyInputPanel from 'components/CurrencyInputPanel/SwapCurrencyInputPanel'
import ErrorIcon from 'components/Icons/Error'
import Row from 'components/Row'
import TokenSafetyModal from 'components/TokenSafety/TokenSafetyModal'
import PriceImpactModal from 'components/swap/PriceImpactModal'
import PriceImpactWarning from 'components/swap/PriceImpactWarning'
import SwapDetailsDropdown from 'components/swap/SwapDetailsDropdown'
import { BridgeQuote } from 'hooks/useBridgeQuote'
import { useCrossChainCallback } from 'hooks/useCrossChainCallback'
import { useCrossChainQuote } from 'hooks/useCrossChainQuote'

import { XCHAINSENDER_ADDRESS } from 'lib/crossChain/constants'
import confirmPriceImpactWithoutFee from 'components/swap/confirmPriceImpactWithoutFee'
import { Field } from 'components/swap/constants'
import { ArrowContainer, ArrowWrapper, OutputSwapSection, SwapSection } from 'components/swap/styled'
import { useIsSupportedChainId, useSupportedChainId } from 'constants/chains'
import { useCurrencyInfo } from 'hooks/Tokens'
import { useAccount } from 'hooks/useAccount'
import { useIsSwapUnsupported } from 'hooks/useIsSwapUnsupported'
import { useMaxAmountIn } from 'hooks/useMaxAmountIn'
import usePermit2Allowance, { AllowanceState } from 'hooks/usePermit2Allowance'
import usePrevious from 'hooks/usePrevious'
import useSelectChain from 'hooks/useSelectChain'
import { SwapResult, useSwapCallback } from 'hooks/useSwapCallback'

import { useUSDPrice } from 'hooks/useUSDPrice'

import useWrapCallback, { WrapErrorText } from 'hooks/useWrapCallback'
import { Trans } from 'i18n'
import JSBI from 'jsbi'
import useNativeCurrency from 'lib/hooks/useNativeCurrency'
import { formatSwapQuoteReceivedEventProperties } from 'lib/utils/analytics'

import { getIsReviewableQuote } from 'pages/Swap'
import { OutputTaxTooltipBody } from 'pages/Swap/TaxTooltipBody'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown } from 'react-feather'
import { useNavigate } from 'react-router-dom'
import { Text } from 'rebass'
import { useCurrencyBalance } from 'state/connection/hooks'
import { useAppSelector } from 'state/hooks'
import { ClassicTrade, InterfaceTrade, RouterPreference, TradeState } from 'state/routing/types'
import { isClassicTrade } from 'state/routing/utils'
import { useSwapActionHandlers, useSwapAndLimitContext, useSwapContext } from 'state/swap/hooks'

import { CurrencyState } from 'state/swap/types'
import { useTheme } from 'styled-components'
import { ExternalLink, ThemedText } from 'theme/components'
import { maybeLogFirstSwapAction } from 'tracing/swapFlowLoggers'
import { UNIVERSE_CHAIN_INFO } from 'uniswap/src/constants/chains'
import { SafetyLevel } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import Trace from 'uniswap/src/features/telemetry/Trace'
import { sendAnalyticsEvent } from 'uniswap/src/features/telemetry/send'
import { WrapType } from 'uniswap/src/types/wrap'
import { logger } from 'utilities/src/logger/logger'
import { useTrace } from 'utilities/src/telemetry/trace/TraceContext'
import { computeFiatValuePriceImpact } from 'utils/computeFiatValuePriceImpact'
import { NumberType, useFormatter } from 'utils/formatNumbers'
import { maxAmountSpend } from 'utils/maxAmountSpend'
import { largerPercentValue } from 'utils/percent'
import { computeRealizedPriceImpact, warningSeverity } from 'utils/prices'
import { didUserReject } from 'utils/swapErrorToUserReadableMessage'

const SWAP_FORM_CURRENCY_SEARCH_FILTERS = {
  showCommonBases: true,
}

interface SwapFormProps {
  disableTokenInputs?: boolean
  onCurrencyChange?: (selected: CurrencyState) => void
}

export function SwapForm({ disableTokenInputs = false, onCurrencyChange }: SwapFormProps) {
  const { isDisconnected, chainId: connectedChainId, address: accountAddress } = useAccount()


  const trace = useTrace()

  const { initialChainId, chainId, inputChainId, prefilledState, currencyState, multichainUXEnabled } = useSwapAndLimitContext()
  // Use inputChainId (sellToken's chain) for allowance/router checks — supports cross-chain
  // where sellToken chain differs from the global context chainId.
  const supportedChainId = useSupportedChainId(inputChainId ?? chainId)
  const { swapState, setSwapState, derivedSwapInfo } = useSwapContext()
  const { typedValue, independentField } = swapState

  // token warning stuff
  const prefilledInputCurrencyInfo = useCurrencyInfo(prefilledState.inputCurrency)
  const prefilledOutputCurrencyInfo = useCurrencyInfo(prefilledState.outputCurrency)
  const [dismissTokenWarning, setDismissTokenWarning] = useState<boolean>(false)
  const [showPriceImpactModal, setShowPriceImpactModal] = useState<boolean>(false)

  const handleConfirmTokenWarning = useCallback(() => {
    setDismissTokenWarning(true)
  }, [])

  // dismiss warning if all imported tokens are in active lists
  const urlTokensNotInDefault = useMemo(
    () =>
      prefilledInputCurrencyInfo || prefilledOutputCurrencyInfo
        ? [prefilledInputCurrencyInfo, prefilledOutputCurrencyInfo]
            .filter(
              (token): token is CurrencyInfo =>
                (token?.currency.isToken && token.safetyLevel !== SafetyLevel.Verified) ?? false,
            )
            .map((token: CurrencyInfo) => token.currency as Token)
        : [],
    [prefilledInputCurrencyInfo, prefilledOutputCurrencyInfo],
  )

  const theme = useTheme()

  // toggle wallet when disconnected
  const accountDrawer = useAccountDrawer()

  const {
    trade: { state: tradeState, trade, swapQuoteLatency },
    allowedSlippage,
    currencyBalances,
    parsedAmount,
    currencies,
    inputError: swapInputError,
    outputFeeFiatValue,
    inputTax,
    outputTax,
  } = derivedSwapInfo

  const [inputTokenHasTax, outputTokenHasTax] = useMemo(
    () => [!inputTax.equalTo(0), !outputTax.equalTo(0)],
    [inputTax, outputTax],
  )

  useEffect(() => {
    // Force exact input if the user switches to an output token with tax
    if (outputTokenHasTax && independentField === Field.OUTPUT) {
      setSwapState((state) => ({
        ...state,
        independentField: Field.INPUT,
        typedValue: '',
      }))
    }
  }, [independentField, outputTokenHasTax, setSwapState, trade?.outputAmount])

  const {
    wrapType,
    execute: onWrap,
    inputError: wrapInputError,
  } = useWrapCallback(currencies[Field.INPUT], currencies[Field.OUTPUT], typedValue)
  const showWrap: boolean = wrapType !== WrapType.NOT_APPLICABLE

  const parsedAmounts = useMemo(
    () =>
      showWrap
        ? {
            [Field.INPUT]: parsedAmount,
            [Field.OUTPUT]: parsedAmount,
          }
        : {
            [Field.INPUT]: independentField === Field.INPUT ? parsedAmount : trade?.inputAmount,
            [Field.OUTPUT]: independentField === Field.OUTPUT ? parsedAmount : trade?.outputAmount,
          },
    [independentField, parsedAmount, showWrap, trade],
  )

  const showFiatValueInput = Boolean(parsedAmounts[Field.INPUT])
  const showFiatValueOutput = Boolean(parsedAmounts[Field.OUTPUT])
  const getSingleUnitAmount = (currency?: Currency) => {
    if (!currency) {
      return
    }
    return CurrencyAmount.fromRawAmount(currency, JSBI.BigInt(10 ** currency.decimals))
  }

  const fiatValueInput = useUSDPrice(
    parsedAmounts[Field.INPUT] ?? getSingleUnitAmount(currencies[Field.INPUT]),
    currencies[Field.INPUT],
  )
  const fiatValueOutput = useUSDPrice(
    parsedAmounts[Field.OUTPUT] ?? getSingleUnitAmount(currencies[Field.OUTPUT]),
    currencies[Field.OUTPUT],
  )

  const [routeNotFound, routeIsLoading, routeIsSyncing] = useMemo(
    () => [
      tradeState === TradeState.NO_ROUTE_FOUND,
      tradeState === TradeState.LOADING,
      tradeState === TradeState.LOADING && Boolean(trade),
    ],
    [trade, tradeState],
  )

  const fiatValueTradeInput = useUSDPrice(trade?.inputAmount)
  const fiatValueTradeOutput = useUSDPrice(trade?.outputAmount)
  const preTaxFiatValueTradeOutput = useUSDPrice(trade?.outputAmount)
  const [stablecoinPriceImpact, preTaxStablecoinPriceImpact] = useMemo(
    () =>
      routeIsSyncing || !isClassicTrade(trade) || showWrap
        ? [undefined, undefined]
        : [
            computeFiatValuePriceImpact(fiatValueTradeInput.data, fiatValueTradeOutput.data),
            computeFiatValuePriceImpact(fiatValueTradeInput.data, preTaxFiatValueTradeOutput.data),
          ],
    [fiatValueTradeInput, fiatValueTradeOutput, preTaxFiatValueTradeOutput, routeIsSyncing, trade, showWrap],
  )

  const { onSwitchTokens, onCurrencySelection, onUserInput } = useSwapActionHandlers()
  const dependentField: Field = independentField === Field.INPUT ? Field.OUTPUT : Field.INPUT

  const handleTypeInput = useCallback(
    (value: string) => {
      onUserInput(Field.INPUT, value)
      maybeLogFirstSwapAction(trace)
    },
    [onUserInput, trace],
  )
  const handleTypeOutput = useCallback(
    (value: string) => {
      onUserInput(Field.OUTPUT, value)
      maybeLogFirstSwapAction(trace)
    },
    [onUserInput, trace],
  )

  const navigate = useNavigate()
  const swapIsUnsupported = useIsSwapUnsupported(currencies[Field.INPUT], currencies[Field.OUTPUT])

  // reset if they close warning without tokens in params
  const handleDismissTokenWarning = useCallback(() => {
    setDismissTokenWarning(true)
    navigate('/swap/')
  }, [navigate])

  // modal and loading
  const [{ showConfirm, tradeToConfirm, swapError, swapResult }, setSwapFormState] = useState<{
    showConfirm: boolean
    tradeToConfirm?: InterfaceTrade
    swapError?: Error
    swapResult?: SwapResult
  }>({
    showConfirm: false,
    tradeToConfirm: undefined,
    swapError: undefined,
    swapResult: undefined,
  })
  const previousConnectedChainId = usePrevious(connectedChainId)
  const previousPrefilledState = usePrevious(prefilledState)
  useEffect(() => {
    if (multichainUXEnabled) {
      return
    }
    const chainChanged = previousConnectedChainId && previousConnectedChainId !== connectedChainId
    const prefilledInputChanged =
      previousPrefilledState?.inputCurrency &&
      !prefilledState.inputCurrency?.equals(previousPrefilledState.inputCurrency)
    const prefilledOutputChanged =
      previousPrefilledState?.outputCurrency &&
      !prefilledState?.outputCurrency?.equals(previousPrefilledState.outputCurrency)

    if (chainChanged || prefilledInputChanged || prefilledOutputChanged) {
      // reset local state
      setSwapFormState({
        tradeToConfirm: undefined,
        swapError: undefined,
        showConfirm: false,
        swapResult: undefined,
      })
    }
  }, [
    connectedChainId,
    multichainUXEnabled,
    prefilledState.inputCurrency,
    prefilledState?.outputCurrency,
    previousConnectedChainId,
    previousPrefilledState,
  ])

  const { formatCurrencyAmount } = useFormatter()
  const formattedAmounts = useMemo(
    () => ({
      [independentField]: typedValue,
      [dependentField]: showWrap
        ? parsedAmounts[independentField]?.toExact() ?? ''
        : formatCurrencyAmount({
            amount: parsedAmounts[dependentField],
            type: NumberType.SwapTradeAmount,
            placeholder: '',
          }),
    }),
    [dependentField, formatCurrencyAmount, independentField, parsedAmounts, showWrap, typedValue],
  )

  const selectChain = useSelectChain()

  const userHasSpecifiedInputOutput = Boolean(
    currencies[Field.INPUT] && currencies[Field.OUTPUT] && parsedAmounts[independentField]?.greaterThan(JSBI.BigInt(0)),
  )

  const maximumAmountIn = useMaxAmountIn(trade, allowedSlippage)
  const allowance = usePermit2Allowance(
    maximumAmountIn ??
      (parsedAmounts[Field.INPUT]?.currency.isToken
        ? (parsedAmounts[Field.INPUT] as CurrencyAmount<Token>)
        : undefined),
    supportedChainId ? UNIVERSAL_ROUTER_ADDRESS(supportedChainId) : undefined,
    trade?.fillType,
  )

  const maxInputAmount: CurrencyAmount<Currency> | undefined = useMemo(
    () => maxAmountSpend(currencyBalances[Field.INPUT]),
    [currencyBalances],
  )
  const showMaxButton = Boolean(maxInputAmount?.greaterThan(0) && !parsedAmounts[Field.INPUT]?.equalTo(maxInputAmount))
  const swapFiatValues = useMemo(() => {
    return { amountIn: fiatValueTradeInput.data, amountOut: fiatValueTradeOutput.data, feeUsd: outputFeeFiatValue }
  }, [fiatValueTradeInput.data, fiatValueTradeOutput.data, outputFeeFiatValue])

  // the callback to execute the swap
  const swapCallback = useSwapCallback(
    trade,
    swapFiatValues,
    allowedSlippage,
    allowance.state === AllowanceState.ALLOWED ? allowance.permitSignature : undefined,
  )

  const handleContinueToReview = useCallback(() => {
    setSwapFormState({
      tradeToConfirm: trade,
      swapError: undefined,
      showConfirm: true,
      swapResult: undefined,
    })
  }, [trade])

  const clearSwapState = useCallback(() => {
    setSwapFormState((currentState) => ({
      ...currentState,
      swapError: undefined,
      swapResult: undefined,
    }))
  }, [])

  const handleSwap = useCallback(() => {
    if (!swapCallback) {
      return
    }
    if (preTaxStablecoinPriceImpact && !confirmPriceImpactWithoutFee(preTaxStablecoinPriceImpact)) {
      return
    }
    swapCallback()
      .then((result) => {
        setSwapFormState((currentState) => ({
          ...currentState,
          swapError: undefined,
          swapResult: result,
        }))
      })
      .catch((error) => {
        setSwapFormState((currentState) => ({
          ...currentState,
          swapError: error,
          swapResult: undefined,
        }))
      })
  }, [swapCallback, preTaxStablecoinPriceImpact])

  const handleOnWrap = useCallback(async () => {
    if (!onWrap) {
      return
    }

    try {
      if (supportedChainId && connectedChainId !== chainId) {
        const correctChain = await selectChain(supportedChainId)
        if (!correctChain) {
          return
        }
      }
      const txHash = await onWrap()
      setSwapFormState((currentState) => ({
        ...currentState,
        swapError: undefined,
        txHash,
      }))
      onUserInput(Field.INPUT, '')
    } catch (error) {
      if (!didUserReject(error)) {
        sendAnalyticsEvent(SwapEventName.SWAP_ERROR, {
          wrapType,
          input: currencies[Field.INPUT],
          output: currencies[Field.OUTPUT],
        })
      } else {
        logger.debug('SwapForm', 'handleOnWrap', 'rejected wrap/unwrap')
      }
      setSwapFormState((currentState) => ({
        ...currentState,
        swapError: error,
        txHash: undefined,
      }))
    }
  }, [currencies, onUserInput, onWrap, wrapType, connectedChainId, chainId, supportedChainId, selectChain])

  // warnings on the greater of fiat value price impact and execution price impact
  const { priceImpactSeverity, largerPriceImpact } = useMemo(() => {
    if (!isClassicTrade(trade)) {
      return { priceImpactSeverity: 0, largerPriceImpact: undefined }
    }

    const marketPriceImpact = trade?.priceImpact ? computeRealizedPriceImpact(trade) : undefined
    const largerPriceImpact = largerPercentValue(marketPriceImpact, preTaxStablecoinPriceImpact)
    return { priceImpactSeverity: warningSeverity(largerPriceImpact), largerPriceImpact }
  }, [preTaxStablecoinPriceImpact, trade])

  const handleConfirmDismiss = useCallback(() => {
    setSwapFormState((currentState) => ({ ...currentState, showConfirm: false }))
    // If swap had a temporary router preference override, we want to reset it
    setSwapState((state) => ({ ...state, routerPreferenceOverride: undefined }))
    // If there was a swap, we want to clear the input
    if (swapResult) {
      onUserInput(Field.INPUT, '')
    }
  }, [onUserInput, setSwapState, swapResult])

  const handleAcceptChanges = useCallback(() => {
    setSwapFormState((currentState) => ({ ...currentState, tradeToConfirm: trade }))
  }, [trade])

  const handleInputSelect = useCallback(
    (inputCurrency: Currency) => {
      onCurrencySelection(Field.INPUT, inputCurrency)
      onCurrencyChange?.({
        inputCurrency,
        outputCurrency: currencyState.outputCurrency,
      })
      maybeLogFirstSwapAction(trace)
    },
    [onCurrencyChange, onCurrencySelection, currencyState, trace],
  )
  const inputCurrencyNumericalInputRef = useRef<HTMLInputElement>(null)

  const handleMaxInput = useCallback(() => {
    maxInputAmount && onUserInput(Field.INPUT, maxInputAmount.toExact())
    maybeLogFirstSwapAction(trace)
  }, [maxInputAmount, onUserInput, trace])

  const handleOutputSelect = useCallback(
    (outputCurrency: Currency) => {
      onCurrencySelection(Field.OUTPUT, outputCurrency)
      onCurrencyChange?.({
        inputCurrency: currencyState.inputCurrency,
        outputCurrency,
      })
      maybeLogFirstSwapAction(trace)
    },
    [onCurrencyChange, onCurrencySelection, currencyState, trace],
  )

  const showPriceImpactWarning = isClassicTrade(trade) && largerPriceImpact && priceImpactSeverity > 3



  const prevTrade = usePrevious(trade)
  useEffect(() => {
    if (!trade || prevTrade === trade) {
      return
    } // no new swap quote to log

    sendAnalyticsEvent(SwapEventName.SWAP_QUOTE_RECEIVED, {
      ...formatSwapQuoteReceivedEventProperties(trade, allowedSlippage, swapQuoteLatency, outputFeeFiatValue),
      ...trace,
    })
  }, [prevTrade, trade, trace, allowedSlippage, swapQuoteLatency, outputFeeFiatValue])

  const showDetailsDropdown = Boolean(
    !showWrap && userHasSpecifiedInputOutput && (trade || routeIsLoading || routeIsSyncing),
  )

  const crossChainQuote = useCrossChainQuote()
  const isCrossChain = Boolean(crossChainQuote)
  const effectiveRoute = crossChainQuote?.effectiveRoute
  const crossChainOutputAmount = crossChainQuote?.outputAmount
  const leg1 = crossChainQuote?.leg1Trade
  const bridgeLeg = crossChainQuote?.bridge
  const leg2 = crossChainQuote?.leg2Trade
  const hasCrossChainQuoteError = crossChainQuote?.quoteFailed ?? false
  const hasSwapLeg1 = Boolean(leg1)
  const leg1Failed = Boolean(leg1?.errorMessage)
  const leg1Trade = leg1?.quote
  const bridgeQuote = bridgeLeg?.quote
  const leg2Trade = leg2?.quote
  const bridgeQuoteErrorMessage = leg1?.errorMessage ?? bridgeLeg?.errorMessage ?? leg2?.errorMessage
  const crossChainLegsLoading = Boolean(leg1?.loading || bridgeLeg?.loading || leg2?.loading)
  // Dùng chung quoteFailed từ hook (đã tính đúng theo bridgeReady + candidates exhausted),
  // thay vì tự suy ra từ errorMessage — tránh lệch với hasCrossChainQuoteError (dùng cho nút)
  // và tránh hiện lỗi stale trong lúc debounce/candidate đang chuyển.
  const bridgeOnlyError = hasCrossChainQuoteError

  // Cross-chain price impact: the top-level SOR `trade` used for `largerPriceImpact` above is
  // always undefined cross-chain (SOR can't quote cross-chain pairs) — use whichever swap leg
  // is actually active instead (leg1 for SWAP_BRIDGE/SWAP_BRIDGE_SWAP, leg2 for BRIDGE_SWAP).
  const crossChainSwapLeg = leg1Trade ?? leg2Trade
  const crossChainPriceImpact = useMemo(() => {
    if (!isClassicTrade(crossChainSwapLeg)) return undefined
    return computeRealizedPriceImpact(crossChainSwapLeg)
  }, [crossChainSwapLeg])




  const crossChainOutputFormatted = useMemo(() => {
    if (!isCrossChain || !crossChainOutputAmount) return ''
    return formatCurrencyAmount({ amount: crossChainOutputAmount, type: NumberType.SwapTradeAmount, placeholder: '' })
  }, [isCrossChain, crossChainOutputAmount, formatCurrencyAmount])




  const [showCrossChainConfirm, setShowCrossChainConfirm] = useState(false)

  const srcChainId = currencies[Field.INPUT]?.chainId as number | undefined

  // Native currency + balance on the source chain, for gas sanity check before enabling the button.
  // ponytail: exact bridge fee (LZ nativeFee / Across relayer fee) is only known on-chain at execute
  // time (see useCrossChainCallback). Here we just check balance > 0 as a cheap pre-check; the real
  // fee is validated when the tx is sent (insufficient funds -> crossChainError surfaces in the modal).
  const crossChainNativeCurrency = useNativeCurrency(srcChainId)
  const crossChainNativeBalance = useCurrencyBalance(accountAddress, crossChainNativeCurrency)
  const hasCrossChainGas = Boolean(crossChainNativeBalance?.greaterThan(0))

  const crossChainBalanceIn = currencyBalances[Field.INPUT]
  const crossChainInputAmount = parsedAmounts[Field.INPUT] as CurrencyAmount<Currency> | undefined
  const hasCrossChainInputBalance = Boolean(
    crossChainBalanceIn && crossChainInputAmount && !crossChainBalanceIn.lessThan(crossChainInputAmount),
  )

  const callbackInputCurrency = currencies[Field.INPUT] ?? null
  const callbackOutputCurrency = currencies[Field.OUTPUT] ?? null
  const callbackInputAmount = (parsedAmounts[Field.INPUT] as CurrencyAmount<Currency> | undefined)

  const crossChainPermit2DataRef = useRef<`0x${string}` | undefined>(undefined)
  const [crossChainPermit2Data, setCrossChainPermit2Data] = useState<`0x${string}` | undefined>(undefined)

  const {
    execute: executeCrossChain,
    status: crossChainStatus,
    txHash: crossChainTxHash,
    error: crossChainError,
    reset: resetCrossChain,
  } = useCrossChainCallback(effectiveRoute, callbackInputCurrency, callbackOutputCurrency, callbackInputAmount, crossChainOutputAmount, leg1Trade as ClassicTrade | undefined, crossChainPermit2Data, leg2Trade as ClassicTrade | undefined)


  const handleOpenCrossChainConfirm = useCallback(() => {
    resetCrossChain()
    setShowCrossChainConfirm(true)
  }, [resetCrossChain])

  const handleDismissBridgeConfirm = useCallback(() => {
    setShowCrossChainConfirm(false)
    if (crossChainStatus === 'success' || (crossChainStatus === 'pending' && !!crossChainTxHash)) {
      onUserInput(Field.INPUT, '')
    }
  }, [crossChainStatus, crossChainTxHash, onUserInput])

  const handleConfirmCrossChain = useCallback(async (permit2Data?: `0x${string}`) => {
    if (permit2Data) {
      crossChainPermit2DataRef.current = permit2Data
      setCrossChainPermit2Data(permit2Data)
    }
    try {
      await executeCrossChain(permit2Data)

    } catch (err) {
      console.error('[CrossChain] handleConfirmCrossChain error:', err)
    }
  }, [executeCrossChain])

  // Cross-chain reviewable: valid route + amount > 0 + both legs quoted successfully.
  // Do NOT check swapInputError — it comes from same-chain SOR which can't quote cross-chain pairs.
  // SWAP_BRIDGE also requires leg1 trade to be VALID (not just route found) and bridge quote present.
  const isCrossChainReviewable = Boolean(
    isCrossChain &&
      effectiveRoute &&
      !effectiveRoute.error &&
      parsedAmount &&
      parsedAmount.greaterThan(0) &&
      !hasCrossChainQuoteError &&
      !crossChainLegsLoading &&
      crossChainOutputAmount &&
      (!hasSwapLeg1 || !leg1Failed) &&
      hasCrossChainInputBalance &&
      hasCrossChainGas,
  )

  const inputCurrency = currencies[Field.INPUT] ?? undefined

  const switchingChain = useAppSelector((state) => state.wallets.switchingChain)
  const targetChain = switchingChain ? switchingChain : undefined
  const switchingChainIsSupported = useIsSupportedChainId(targetChain)
  // @ts-ignore
  const isUsingBlockedExtension = window.ethereum?.['isPocketUniverseZ']

  return (
    <>
      <TokenSafetyModal
        isOpen={urlTokensNotInDefault.length > 0 && !dismissTokenWarning}
        token0={urlTokensNotInDefault[0]}
        token1={urlTokensNotInDefault[1]}
        onContinue={handleConfirmTokenWarning}
        onCancel={handleDismissTokenWarning}
        showCancel={true}
      />
      {trade && showConfirm && (
        <ConfirmSwapModal
          trade={trade}
          priceImpact={largerPriceImpact}
          inputCurrency={inputCurrency}
          originalTrade={tradeToConfirm}
          onAcceptChanges={handleAcceptChanges}
          onCurrencySelection={onCurrencySelection}
          swapResult={swapResult}
          allowedSlippage={allowedSlippage}
          clearSwapState={clearSwapState}
          onConfirm={handleSwap}
          allowance={allowance}
          swapError={swapError}
          onDismiss={handleConfirmDismiss}
          onXV2RetryWithClassic={() => {
            // Keep swap parameters but re-quote X trade with classic API
            setSwapState((state) => ({
              ...state,
              routerPreferenceOverride: RouterPreference.API,
            }))
            handleContinueToReview()
          }}
          fiatValueInput={fiatValueTradeInput}
          fiatValueOutput={fiatValueTradeOutput}
        />
      )}
      {showPriceImpactModal && showPriceImpactWarning && (
        <PriceImpactModal
          priceImpact={largerPriceImpact}
          onDismiss={() => setShowPriceImpactModal(false)}
          onContinue={() => {
            setShowPriceImpactModal(false)
            handleContinueToReview()
          }}
        />
      )}
      {/* Cross chain confirm modal */}
      {showCrossChainConfirm && (
        <ConfirmCrossChainModal
          crossChainProps={{
            route: effectiveRoute!,

            inputCurrency: currencies[Field.INPUT],
            outputCurrency: currencies[Field.OUTPUT],
            crossChainInputAmount: (parsedAmounts[Field.INPUT] as CurrencyAmount<Currency> | undefined),
            crossChainOutputAmount,
            bridgeQuote,
            leg1Trade,
            leg2Trade,
            allowedSlippage: hasSwapLeg1 || Boolean(leg2Trade) ? allowedSlippage : undefined,


          }}
          onCrossChainHandle={handleConfirmCrossChain}
          spender={srcChainId ? XCHAINSENDER_ADDRESS[srcChainId] : undefined}
          crossChainStatus={crossChainStatus}
          crossChainTxHash={crossChainTxHash}
          crossChainError={crossChainError}
          onDismiss={handleDismissBridgeConfirm}
        />
      )}
      <div style={{ display: 'relative' }}>
        <SwapSection>
          <Trace section={InterfaceSectionName.CURRENCY_INPUT_PANEL}>
            <SwapCurrencyInputPanel
              label={<Trans i18nKey="common.sell.label" />}
              disabled={disableTokenInputs}
              value={formattedAmounts[Field.INPUT]}
              showMaxButton={showMaxButton}
              currency={currencies[Field.INPUT] ?? null}
              onUserInput={handleTypeInput}
              onMax={handleMaxInput}
              fiatValue={showFiatValueInput ? fiatValueInput : undefined}
              onCurrencySelect={handleInputSelect}
              field={Field.INPUT}
              otherCurrency={currencies[Field.OUTPUT]}
              currencySearchFilters={SWAP_FORM_CURRENCY_SEARCH_FILTERS}
              id={InterfaceSectionName.CURRENCY_INPUT_PANEL}
              loading={independentField === Field.OUTPUT && routeIsSyncing}
              ref={inputCurrencyNumericalInputRef}
            />
          </Trace>
        </SwapSection>
        <ArrowWrapper clickable={!!supportedChainId}>
          <Trace
            logPress
            eventOnTrigger={SwapEventName.SWAP_TOKENS_REVERSED}
            element={InterfaceElementName.SWAP_TOKENS_REVERSE_ARROW_BUTTON}
          >
            <ArrowContainer
              data-testid="swap-currency-button"
              onClick={() => {
                if (disableTokenInputs) {
                  return
                }
                onSwitchTokens({
                  newOutputHasTax: inputTokenHasTax,
                  previouslyEstimatedOutput: formattedAmounts[dependentField],
                })
                maybeLogFirstSwapAction(trace)
              }}
              color={theme.neutral1}
            >
              <ArrowDown size="16" color={theme.neutral1} />
            </ArrowContainer>
          </Trace>
        </ArrowWrapper>
      </div>
      <AutoColumn gap="xs">
        <div>
          <OutputSwapSection>
            <Trace section={InterfaceSectionName.CURRENCY_OUTPUT_PANEL}>
              <SwapCurrencyInputPanel
                value={isCrossChain ? crossChainOutputFormatted : formattedAmounts[Field.OUTPUT]}
                disabled={disableTokenInputs}
                onUserInput={handleTypeOutput}
                label={<Trans i18nKey="common.buy.label" />}
                showMaxButton={false}
                hideBalance={false}
                fiatValue={isCrossChain ? undefined : (showFiatValueOutput ? fiatValueOutput : undefined)}
                priceImpact={isCrossChain ? undefined : stablecoinPriceImpact}
                currency={currencies[Field.OUTPUT] ?? null}
                onCurrencySelect={handleOutputSelect}
                field={Field.OUTPUT}
                otherCurrency={currencies[Field.INPUT]}
                currencySearchFilters={SWAP_FORM_CURRENCY_SEARCH_FILTERS}
                id={InterfaceSectionName.CURRENCY_OUTPUT_PANEL}
                loading={independentField === Field.INPUT && routeIsSyncing}
                numericalInputSettings={{
                  // We disable numerical input here if the selected token has tax, since we cannot guarantee exact_outputs for FOT tokens
                  disabled: inputTokenHasTax || outputTokenHasTax,
                  // Focus the input currency panel if the user tries to type into the disabled output currency panel
                  onDisabledClick: () => inputCurrencyNumericalInputRef.current?.focus(),
                  disabledTooltipBody: (
                    <OutputTaxTooltipBody
                      currencySymbol={currencies[inputTokenHasTax ? Field.INPUT : Field.OUTPUT]?.symbol}
                    />
                  ),
                }}
              />
            </Trace>
          </OutputSwapSection>
        </div>

        {showPriceImpactWarning && <PriceImpactWarning priceImpact={largerPriceImpact} />}
        <div>
          {swapIsUnsupported ? (
            <ButtonPrimary $borderRadius="16px" disabled={true}>
              <ThemedText.DeprecatedMain mb="4px">
                <Trans i18nKey="common.unsupportedAsset_one" />
              </ThemedText.DeprecatedMain>
            </ButtonPrimary>
          ) : !multichainUXEnabled && switchingChain ? (
            <ButtonPrimary $borderRadius="16px" disabled={true}>
              <Trans
                i18nKey="common.connectingToChain"
                values={{
                  chainName: switchingChainIsSupported ? UNIVERSE_CHAIN_INFO[targetChain]?.label : '',
                }}
              />
            </ButtonPrimary>
          ) : isDisconnected ? (
            <Trace
              logPress
              eventOnTrigger={InterfaceEventName.CONNECT_WALLET_BUTTON_CLICKED}
              properties={{ received_swap_quote: getIsReviewableQuote(trade, tradeState, swapInputError) }}
              element={InterfaceElementName.CONNECT_WALLET_BUTTON}
            >
              <ButtonLight onClick={accountDrawer.open} fontWeight={535} $borderRadius="16px">
                <Trans i18nKey="common.connectWallet.button" />
              </ButtonLight>
            </Trace>
          ) : !multichainUXEnabled && initialChainId && initialChainId !== connectedChainId ? (
            <ButtonPrimary $borderRadius="16px" onClick={async () => await selectChain(initialChainId)}>
              <Trans
                i18nKey="common.connectToChain.button"
                values={{ chainName: supportedChainId ? UNIVERSE_CHAIN_INFO[initialChainId].label : '' }}
              />
            </ButtonPrimary>
          ) : showWrap ? (
            <ButtonPrimary
              $borderRadius="16px"
              disabled={Boolean(wrapInputError)}
              onClick={handleOnWrap}
              fontWeight={535}
              data-testid="wrap-button"
            >
              {wrapInputError ? (
                <WrapErrorText wrapInputError={wrapInputError} />
              ) : wrapType === WrapType.WRAP ? (
                <Trans i18nKey="common.wrap.button" />
              ) : wrapType === WrapType.UNWRAP ? (
                <Trans i18nKey="common.unwrap.button" />
              ) : null}
            </ButtonPrimary>
          ) : isCrossChain && hasCrossChainQuoteError && userHasSpecifiedInputOutput ? (
            <GrayCard style={{ textAlign: 'center' }}>
              <ThemedText.DeprecatedMain mb="4px">
                {leg1Failed ? (
                  <Trans i18nKey="swap.form.insufficientLiquidity" />
                ) : (
                  <Trans i18nKey="swap.form.bridgeUnavailable" />
                )}
              </ThemedText.DeprecatedMain>
            </GrayCard>
          ) : isCrossChain ? (

            // ── Cross-chain button ──────────────────────────────────────
            <ButtonError
              onClick={handleOpenCrossChainConfirm}
              id="cross-chain-button"
              data-testid="cross-chain-button"
              disabled={!isCrossChainReviewable}
              error={false}
            >
              <Text fontSize={20}>
                <Trans i18nKey="common.swap" />
              </Text>
            </ButtonError>
          ) : routeNotFound && userHasSpecifiedInputOutput && !routeIsLoading && !routeIsSyncing ? (

            <GrayCard style={{ textAlign: 'center' }}>
              <ThemedText.DeprecatedMain mb="4px">
                <Trans i18nKey="swap.form.insufficientLiquidity" />
              </ThemedText.DeprecatedMain>
            </GrayCard>
          ) : (
            <Trace logPress element={InterfaceElementName.SWAP_BUTTON}>
              <ButtonError
                onClick={async () => {
                  const tradeInputChainId = trade?.inputAmount?.currency?.chainId
                  let correctChain = true
                  if (tradeInputChainId && tradeInputChainId !== connectedChainId) {
                    correctChain = await selectChain(tradeInputChainId)
                  }
                  if (correctChain) {
                    showPriceImpactWarning ? setShowPriceImpactModal(true) : handleContinueToReview()
                  }
                }}
                id="swap-button"
                data-testid="swap-button"
                disabled={isUsingBlockedExtension || !getIsReviewableQuote(trade, tradeState, swapInputError)}
                error={!swapInputError && priceImpactSeverity > 2 && allowance.state === AllowanceState.ALLOWED}
              >
                <Text fontSize={20}>
                  {swapInputError ? (
                    swapInputError
                  ) : routeIsSyncing || routeIsLoading ? (
                    <Trans i18nKey="common.swap" />
                  ) : priceImpactSeverity > 2 ? (
                    <Trans i18nKey="swap.form.swapAnywayAction" />
                  ) : (
                    <Trans i18nKey="common.swap" />
                  )}
                </Text>
              </ButtonError>
            </Trace>
          )}
          {(showDetailsDropdown || (isCrossChain && effectiveRoute && !effectiveRoute.error && parsedAmounts[Field.INPUT])) && (

            <CrossChainSwapDetails
              isCrossChain={isCrossChain}
              trade={trade}
              leg1Trade={leg1Trade}
              leg2Trade={leg2Trade}
              isSwapBridge={hasSwapLeg1}
              routeIsSyncing={routeIsSyncing}
              routeIsLoading={routeIsLoading}
              allowedSlippage={allowedSlippage}
              largerPriceImpact={isCrossChain ? crossChainPriceImpact : largerPriceImpact}
              crossChainRoute={effectiveRoute}

              currencies={currencies}

              bridgeQuote={bridgeQuote}
              bridgeQuoteLoading={crossChainLegsLoading}
              bridgeQuoteError={bridgeOnlyError}

              crossChainInputAmount={crossChainInputAmount}
              crossChainOutputAmount={crossChainOutputAmount}
              bridgeQuoteErrorMessage={bridgeQuoteErrorMessage}
            />


          )}

          {isUsingBlockedExtension && <SwapNotice />}

        </div>
      </AutoColumn>
    </>
  )
}

interface CrossChainSwapDetailsProps {
  isCrossChain: boolean
  trade: InterfaceTrade | undefined
  leg1Trade: InterfaceTrade | undefined
  leg2Trade: InterfaceTrade | undefined
  isSwapBridge: boolean
  routeIsSyncing: boolean
  routeIsLoading: boolean
  allowedSlippage: any
  largerPriceImpact: any
  crossChainRoute: any
  currencies: any
  bridgeQuote: BridgeQuote | undefined
  bridgeQuoteLoading?: boolean
  bridgeQuoteError?: boolean
  bridgeQuoteErrorMessage?: string
  crossChainInputAmount?: CurrencyAmount<Currency>
  crossChainOutputAmount?: CurrencyAmount<Currency>
}

function CrossChainSwapDetails({
  isCrossChain,
  trade,
  leg1Trade,
  leg2Trade,
  isSwapBridge,
  routeIsSyncing,
  routeIsLoading,
  allowedSlippage,
  largerPriceImpact,
  crossChainRoute,
  currencies,
  bridgeQuote,
  bridgeQuoteLoading,
  bridgeQuoteError,
  bridgeQuoteErrorMessage,
  crossChainInputAmount,
  crossChainOutputAmount,
}: CrossChainSwapDetailsProps) {

  // leg1Trade covers SWAP_BRIDGE/SWAP_BRIDGE_SWAP; BRIDGE_SWAP has no leg1Trade so fall back
  // to leg2Trade (was falling back to top-level `trade`, which is always undefined cross-chain
  // since SOR can't quote cross-chain pairs — hid all leg2 info, looked like bridge-only).
  const displayTrade = leg1Trade ?? (isCrossChain ? leg2Trade : trade)


  return (
    <>
      <SwapDetailsDropdown
        trade={displayTrade}
        syncing={routeIsSyncing}
        loading={routeIsLoading || (bridgeQuoteLoading ?? false)}
        allowedSlippage={allowedSlippage}
        priceImpact={largerPriceImpact}
        crossChainRoute={isCrossChain ? crossChainRoute : undefined}
        inputCurrency={isCrossChain ? (currencies[Field.INPUT] ?? null) : null}
        outputCurrency={isCrossChain ? (currencies[Field.OUTPUT] ?? null) : null}
        leg1Trade={isSwapBridge ? leg1Trade : undefined}
        leg2Trade={leg2Trade}
        bridgeQuote={bridgeQuote}
        crossChainInputAmount={crossChainInputAmount}
        crossChainOutputAmount={crossChainOutputAmount}
      />

      {bridgeQuoteError && (
        <Row justify="center" data-testid="bridge-quote-error-row">
          <ThemedText.BodySmall color="critical" style={{ wordBreak: 'break-word', textAlign: 'center' }}>
            {bridgeQuoteErrorMessage ? (
              <Trans i18nKey="swap.form.bridgeUnavailableWithReason" values={{ reason: bridgeQuoteErrorMessage }} />
            ) : (
              <Trans i18nKey="swap.form.bridgeUnavailable" />
            )}
          </ThemedText.BodySmall>
        </Row>
      )}
    </>
  )
}

function SwapNotice() {


  const theme = useTheme()
  return (
    <Row
      align="flex-start"
      gap="md"
      backgroundColor={theme.surface2}
      marginTop="12px"
      borderRadius="12px"
      padding="16px"
    >
      <Row width="auto" borderRadius="16px" backgroundColor={theme.critical2} padding="8px">
        <ErrorIcon />
      </Row>

      <Column flex="10" gap="sm">
        <ThemedText.SubHeader>Blocked Extension</ThemedText.SubHeader>
        <ThemedText.BodySecondary lineHeight="22px">
          <Trans
            i18nKey="swap.form.pocketUniverseExtension.warning"
            components={{
              termsLink: (
                <ExternalLink href="https://uniswap.org/terms-of-service">
                  <Trans i18nKey="common.termsOfService" />
                </ExternalLink>
              ),
            }}
          />
        </ThemedText.BodySecondary>
      </Column>
    </Row>
  )
}
