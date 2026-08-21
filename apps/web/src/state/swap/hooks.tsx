import { Currency, CurrencyAmount, TradeType } from '@uniswap/sdk-core'
import { Field } from 'components/swap/constants'
import { TESTNET_CHAIN_IDS, useSupportedChainId } from 'constants/chains'
import { NATIVE_CHAIN_ID } from 'constants/tokens'
import { supportedChainIdFromGQLChain } from 'graphql/data/util'
import { useCurrency } from 'hooks/Tokens'
import { useCrossChainRoute } from 'hooks/useCrossChainRoute'
import { useAccount } from 'hooks/useAccount'
import useAutoSlippageTolerance from 'hooks/useAutoSlippageTolerance'
import { useDebouncedTrade } from 'hooks/useDebouncedTrade'
import useParsedQueryString from 'hooks/useParsedQueryString'
import { useSwapTaxes } from 'hooks/useSwapTaxes'
import { useTokenBalances } from 'hooks/useTokenBalances'
import { useUSDPrice } from 'hooks/useUSDPrice'
import { Trans } from 'i18n'
import useNativeCurrency from 'lib/hooks/useNativeCurrency'
import tryParseCurrencyAmount from 'lib/utils/tryParseCurrencyAmount'
import { ParsedQs } from 'qs'
import { ReactNode, useCallback, useContext, useMemo, useRef } from 'react'
import { useCurrencyBalance, useCurrencyBalances } from 'state/connection/hooks'
import { InterfaceTrade, RouterPreference, TradeState } from 'state/routing/types'
import { isClassicTrade, isSubmittableTrade, isUniswapXTrade } from 'state/routing/utils'
import {
  CurrencyState,
  SerializedCurrencyState,
  SwapAndLimitContext,
  SwapContext,
  SwapInfo,
  SwapState,
} from 'state/swap/types'
import { useUserSlippageToleranceWithDefault } from 'state/user/hooks'
import { FeatureFlags } from 'uniswap/src/features/gating/flags'
import { useFeatureFlag } from 'uniswap/src/features/gating/hooks'
import { InterfaceChainId, UniverseChainId } from 'uniswap/src/types/chains'
import { isAddress } from 'utilities/src/addresses'
import { getParsedChainId } from 'utils/chains'

export function useSwapContext() {
  return useContext(SwapContext)
}

export function useSwapAndLimitContext() {
  const account = useAccount()
  const context = useContext(SwapAndLimitContext)

  // Certain components are used both inside the swap and limit context, and outside of it.
  // One example is the CurrencySearch component, which is used in the swap context, but also in
  // the add/remove liquidity flows, nft flows, etc. In these cases, we want to use the chainId
  // from the provider account (hooks/useAccount), instead of the swap context chainId.
  const fallbackChainId = context.isSwapAndLimitContext ? context.chainId : account.chainId
  return {
    ...context,
    chainId: fallbackChainId,
    // Per-field chain IDs: independent of each other and of the global chainId.
    // Outside swap context, both fall back to account chainId.
    inputChainId: context.isSwapAndLimitContext ? context.inputChainId : account.chainId,
    outputChainId: context.isSwapAndLimitContext ? context.outputChainId : account.chainId,
  }
}

export function useSwapActionHandlers(): {
  onCurrencySelection: (field: Field, currency: Currency) => void
  onSwitchTokens: (options: { newOutputHasTax: boolean; previouslyEstimatedOutput: string }) => void
  onUserInput: (field: Field, typedValue: string) => void
} {
  const { swapState, setSwapState } = useSwapContext()
  const { currencyState, setCurrencyState } = useSwapAndLimitContext()

  const onCurrencySelection = useCallback(
    (field: Field, currency: Currency) => {
      const [currentCurrencyKey, otherCurrencyKey]: (keyof CurrencyState)[] =
        field === Field.INPUT ? ['inputCurrency', 'outputCurrency'] : ['outputCurrency', 'inputCurrency']
      const otherCurrency = currencyState[otherCurrencyKey]
      // the case where we have to swap the order
      if (otherCurrency && currency.equals(otherCurrency)) {
        setCurrencyState({
          [currentCurrencyKey]: currency,
          [otherCurrencyKey]: currencyState[currentCurrencyKey],
        })
        setSwapState((swapState) => ({
          ...swapState,
          independentField: swapState.independentField === Field.INPUT ? Field.OUTPUT : Field.INPUT,
        }))
        // Cross-chain: keep the other token — don't clear it (enables cross-chain swap UX)
      } else if (otherCurrency?.chainId !== currency.chainId) {
        setCurrencyState((state) => ({
          ...state,
          [currentCurrencyKey]: currency,
        }))
      } else {
        setCurrencyState((state) => ({
          ...state,
          [currentCurrencyKey]: currency,
        }))
      }
    },
    [currencyState, setCurrencyState, setSwapState],
  )

  const onSwitchTokens = useCallback(
    ({
      newOutputHasTax,
      previouslyEstimatedOutput,
    }: {
      newOutputHasTax: boolean
      previouslyEstimatedOutput: string
    }) => {
      const { inputCurrency, outputCurrency } = currencyState
      const isCrossChain = Boolean(
        inputCurrency && outputCurrency && inputCurrency.chainId !== outputCurrency.chainId,
      )

      if (isCrossChain) {
        // Cross-chain: leg1/bridge quotes are one-directional — there's no reverse SOR quote
        // to flip to like same-chain does. Force exact-in on the new sell token so typedValue
        // survives the switch; useCrossChainRoute/useDerivedSwapInfo/useBridgeQuote all key off
        // currencyState + typedValue and will re-quote (new intermediate token, leg1, bridge)
        // automatically once currencyState below flips.
        setSwapState((prev) => ({ ...prev, independentField: Field.INPUT }))
      } else if (newOutputHasTax && swapState.independentField === Field.INPUT) {
        // To prevent swaps with FOT tokens as exact-outputs, we leave it as an exact-in swap and use the previously estimated output amount as the new exact-in amount.
        setSwapState((swapState) => ({
          ...swapState,
          typedValue: previouslyEstimatedOutput,
        }))
      } else {
        setSwapState((prev) => ({
          ...prev,
          independentField: prev.independentField === Field.INPUT ? Field.OUTPUT : Field.INPUT,
        }))
      }

      setCurrencyState((prev) => ({
        inputCurrency: prev.outputCurrency,
        outputCurrency: prev.inputCurrency,
      }))
    },
    [currencyState, setCurrencyState, setSwapState, swapState.independentField],
  )


  const onUserInput = useCallback(
    (field: Field, typedValue: string) => {
      setSwapState((state) => {
        return {
          ...state,
          independentField: field,
          typedValue,
        }
      })
    },
    [setSwapState],
  )

  return {
    onSwitchTokens,
    onCurrencySelection,
    onUserInput,
  }
}

// from the current swap inputs, compute the best trade and return it.
export function useDerivedSwapInfo(state: SwapState): SwapInfo {
  const account = useAccount()
  const {
    chainId,
    currencyState: { inputCurrency, outputCurrency },
  } = useSwapAndLimitContext()
  // Cross-chain: use sellToken's chainId for gas check, not global context chainId
  const sellChainId = (inputCurrency?.chainId ?? chainId) as typeof chainId
  const nativeCurrency = useNativeCurrency(sellChainId)
  const balance = useCurrencyBalance(account.address, nativeCurrency)

  const { independentField, typedValue } = state

  // ── Cross-chain: determine effective output currency for SOR (leg 1 only) ──
  const { route: crossChainRoute, isCrossChain } = useCrossChainRoute(inputCurrency, outputCurrency)

  // BRIDGE_ONLY / BRIDGE_SWAP: leg1 is bridge, not swap — skip SOR entirely (leg2 swap handled separately)
  const isBridgeOnly =
    isCrossChain && (crossChainRoute?.routeCase === 'BRIDGE_ONLY' || crossChainRoute?.routeCase === 'BRIDGE_SWAP')

  // For SWAP_BRIDGE and SWAP_BRIDGE_SWAP, SOR on src chain should quote to the
  // src-chain intermediate token, not the final buyToken on the dst chain.
  // SWAP_BRIDGE walks candidateIntermediateTokens sequentially (see lib/crossChain/PLAN.md);
  // state.crossChainCandidateIndex tracks which candidate SwapForm is currently trying.
  const srcIntermediateToken =
    isCrossChain && crossChainRoute
      ? crossChainRoute.routeCase === 'SWAP_BRIDGE'
        ? crossChainRoute.candidateIntermediateTokens?.[state.crossChainCandidateIndex ?? 0] ??
          crossChainRoute.intermediateToken ??
          null
        : crossChainRoute.routeCase === 'SWAP_BRIDGE_SWAP'
          ? crossChainRoute.candidateIntermediateTokenPairs?.[state.crossChainCandidateIndex ?? 0]?.src ??
            crossChainRoute.intermediateTokenSrc ??
            null
          : null

      : null


  // Convert IntermediateToken → Currency via useCurrency hook
  const srcIntermediateCurrency = useCurrency(
    srcIntermediateToken?.address,
    srcIntermediateToken?.chainId as InterfaceChainId | undefined,
    !srcIntermediateToken,
  )

  // Effective output currency for SOR: intermediate on src chain (if cross-chain leg 1), else original
  // BRIDGE_ONLY: pass undefined so useDebouncedTrade is skipped
  const effectiveOutputCurrency = isBridgeOnly ? undefined : (srcIntermediateCurrency ?? outputCurrency)

  const { inputTax, outputTax } = useSwapTaxes(
    inputCurrency?.isToken ? inputCurrency.address : undefined,
    effectiveOutputCurrency?.isToken ? effectiveOutputCurrency.address : undefined,
    chainId,
  )

  const relevantTokenBalances = useCurrencyBalances(
    account.address,
    useMemo(() => [inputCurrency ?? undefined, outputCurrency ?? undefined], [inputCurrency, outputCurrency]),
  )

  const isExactIn: boolean = independentField === Field.INPUT
  const parsedAmount = useMemo(
    () => tryParseCurrencyAmount(typedValue, (isExactIn ? inputCurrency : outputCurrency) ?? undefined),
    [inputCurrency, isExactIn, outputCurrency, typedValue],
  )

  const trade: {
    state: TradeState
    trade?: InterfaceTrade
    swapQuoteLatency?: number
  } = useDebouncedTrade(
    isExactIn ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT,
    parsedAmount,
    // Cross-chain leg 1: quote to intermediate token on src chain; otherwise use original output
    (isExactIn ? effectiveOutputCurrency : inputCurrency) ?? undefined,
    state.routerPreferenceOverride as RouterPreference.API | undefined,
    account.address,
  )

  const { data: nativeCurrencyBalanceUSD } = useUSDPrice(balance, nativeCurrency)

  const { data: outputFeeFiatValue } = useUSDPrice(
    isSubmittableTrade(trade.trade) && trade.trade.swapFee
      ? CurrencyAmount.fromRawAmount(trade.trade.outputAmount.currency, trade.trade.swapFee.amount)
      : undefined,
    trade.trade?.outputAmount.currency,
  )

  const currencyBalances = useMemo(
    () => ({
      [Field.INPUT]: relevantTokenBalances[0],
      [Field.OUTPUT]: relevantTokenBalances[1],
    }),
    [relevantTokenBalances],
  )

  const currencies: { [field in Field]?: Currency } = useMemo(
    () => ({
      [Field.INPUT]: inputCurrency,
      [Field.OUTPUT]: outputCurrency,
    }),
    [inputCurrency, outputCurrency],
  )

  // allowed slippage for classic trades is either auto slippage, or custom user defined slippage if auto slippage disabled
  const classicAutoSlippage = useAutoSlippageTolerance(isClassicTrade(trade.trade) ? trade.trade : undefined)

  // slippage for uniswapx trades is defined by the quote response
  const uniswapXAutoSlippage = isUniswapXTrade(trade.trade) ? trade.trade.slippageTolerance : undefined

  // Uniswap interface recommended slippage amount
  const autoSlippage = uniswapXAutoSlippage ?? classicAutoSlippage
  const classicAllowedSlippage = useUserSlippageToleranceWithDefault(autoSlippage)

  // slippage amount used to submit the trade
  const allowedSlippage = uniswapXAutoSlippage ?? classicAllowedSlippage

  const isTestnet = sellChainId !== undefined && TESTNET_CHAIN_IDS.includes(sellChainId)

  // totalGasUseEstimateUSD is greater than native token balance
  const insufficientGas =
    !isTestnet &&
    isClassicTrade(trade.trade) &&
    (nativeCurrencyBalanceUSD ?? 0) < (trade.trade.totalGasUseEstimateUSDWithBuffer ?? 0)

  const { isDisconnected } = useAccount()
  const inputError = useMemo(() => {
    let inputError: ReactNode | undefined

    if (!account.isConnected) {
      inputError = isDisconnected ? (
        <Trans i18nKey="common.connectWallet.button" />
      ) : (
        <Trans i18nKey="common.connectingWallet" />
      )
    }

    if (!currencies[Field.INPUT] || !currencies[Field.OUTPUT]) {
      inputError = inputError ?? <Trans i18nKey="common.selectToken.label" />
    }

    if (!parsedAmount) {
      inputError = inputError ?? <Trans i18nKey="common.noAmount.error" />
    }

    if (insufficientGas) {
      inputError = (
        <Trans
          i18nKey="common.insufficientTokenBalance.error"
          values={{
            tokenSymbol: nativeCurrency.symbol,
          }}
        />
      )
    }

    // compare input balance to max input based on version
    const balanceIn = currencyBalances[Field.INPUT]
    if (isBridgeOnly) {
      // BRIDGE_ONLY: no SOR trade — check balance directly against parsedAmount
      if (balanceIn && parsedAmount && balanceIn.lessThan(parsedAmount)) {
        inputError = (
          <Trans
            i18nKey="common.insufficientTokenBalance.error"
            values={{ tokenSymbol: balanceIn.currency.symbol }}
          />
        )
      }
      // Cross-chain route error (e.g. unsupported chain pair)
      if (crossChainRoute?.error) {
        inputError = inputError ?? <>{crossChainRoute.error}</>
      }
    } else {
      const maxAmountIn = trade?.trade?.maximumAmountIn(allowedSlippage)
      if (balanceIn && maxAmountIn && balanceIn.lessThan(maxAmountIn)) {
        inputError = (
          <Trans
            i18nKey="common.insufficientTokenBalance.error"
            values={{ tokenSymbol: balanceIn.currency.symbol }}
          />
        )
      }
    }

    return inputError
  }, [
    account.isConnected,
    currencies,
    parsedAmount,
    currencyBalances,
    trade?.trade,
    allowedSlippage,
    isDisconnected,
    insufficientGas,
    nativeCurrency.symbol,
    isBridgeOnly,
    crossChainRoute,
  ])

  return useMemo(
    () => ({
      currencies,
      currencyBalances,
      parsedAmount,
      inputError,
      trade,
      autoSlippage,
      allowedSlippage,
      outputFeeFiatValue,
      inputTax,
      outputTax,
    }),
    [
      allowedSlippage,
      autoSlippage,
      currencies,
      currencyBalances,
      inputError,
      outputFeeFiatValue,
      parsedAmount,
      trade,
      inputTax,
      outputTax,
    ],
  )
}

function parseCurrencyFromURLParameter(urlParam: ParsedQs[string]): string {
  if (typeof urlParam === 'string') {
    const valid = isAddress(urlParam)
    if (valid) {
      return valid
    }
    const upper = urlParam.toUpperCase()
    if (upper === 'ETH') {
      return 'ETH'
    }
  }
  return ''
}

export function queryParametersToCurrencyState(parsedQs: ParsedQs): SerializedCurrencyState {
  const inputCurrency = parseCurrencyFromURLParameter(parsedQs.inputCurrency ?? parsedQs.inputcurrency)
  let outputCurrency = parseCurrencyFromURLParameter(parsedQs.outputCurrency ?? parsedQs.outputcurrency)
  const chainId = getParsedChainId(parsedQs)
  if (inputCurrency === outputCurrency) {
    // clear output if identical
    outputCurrency = ''
  }

  return {
    inputCurrencyId: inputCurrency === '' ? undefined : inputCurrency ?? undefined,
    outputCurrencyId: outputCurrency === '' ? undefined : outputCurrency ?? undefined,
    chainId,
  }
}

export function useInitialCurrencyState(): {
  initialInputCurrency?: Currency
  initialOutputCurrency?: Currency
  initialChainId: InterfaceChainId
} {
  const multichainUXEnabled = useFeatureFlag(FeatureFlags.MultichainUX)

  const parsedQs = useParsedQueryString()
  const parsedCurrencyState = useMemo(() => {
    return queryParametersToCurrencyState(parsedQs)
  }, [parsedQs])

  const account = useAccount()
  // Freeze wallet chainId as of first connect: with multichain UX, sellToken/buyToken
  // chains are independent of the connected wallet chain. The wallet chain can change
  // mid-flow (e.g. app-triggered switchChain to sign the swap tx); using a live
  // account.chainId here would recompute "initial" currencies and clobber the user's
  // already-selected sellToken/buyToken. ponytail: only freezes on first connect, not on
  // manual wallet chain switches after that; add per-tab-open dep if that becomes an issue.
  const frozenAccountChainIdRef = useRef<InterfaceChainId | undefined>(
    account.isConnected ? account.chainId : undefined,
  )
  if (frozenAccountChainIdRef.current === undefined && account.isConnected && account.chainId !== undefined) {
    frozenAccountChainIdRef.current = account.chainId
  }
  const accountChainIdForDefault = frozenAccountChainIdRef.current
  const supportedChainId =
    useSupportedChainId(parsedCurrencyState.chainId ?? accountChainIdForDefault) ?? UniverseChainId.Mainnet

  const { balanceList } = useTokenBalances({ cacheOnly: true })

  const { initialInputCurrencyAddress, initialChainId } = useMemo(() => {
    // Handle query params or disconnected state
    if (parsedCurrencyState.inputCurrencyId) {
      return {
        initialInputCurrencyAddress: parsedCurrencyState.inputCurrencyId,
        initialChainId: supportedChainId,
      }
    } else if (
      !multichainUXEnabled ||
      !account.isConnected ||
      !balanceList ||
      parsedCurrencyState.chainId ||
      parsedCurrencyState.outputCurrencyId
    ) {
      return {
        initialInputCurrencyAddress: parsedCurrencyState.outputCurrencyId ? undefined : 'ETH',
        initialChainId: supportedChainId,
      }
    }
    // If no query params & connected, return the native token where user has the highest USD value
    let highestBalance = 0
    let highestBalanceNativeTokenAddress = 'ETH'
    let highestBalanceChainId = UniverseChainId.Mainnet
    balanceList.forEach((balance) => {
      if (
        balance?.token?.standard === NATIVE_CHAIN_ID &&
        balance?.denominatedValue?.value &&
        balance?.denominatedValue?.value > highestBalance
      ) {
        highestBalance = balance.denominatedValue.value
        highestBalanceNativeTokenAddress = balance?.token.address ?? 'ETH'
        highestBalanceChainId = supportedChainIdFromGQLChain(balance.token.chain) ?? UniverseChainId.Mainnet
      }
    })
    return { initialInputCurrencyAddress: highestBalanceNativeTokenAddress, initialChainId: highestBalanceChainId }
  }, [
    account.isConnected,
    balanceList,
    multichainUXEnabled,
    parsedCurrencyState.chainId,
    parsedCurrencyState.inputCurrencyId,
    parsedCurrencyState.outputCurrencyId,
    supportedChainId,
  ])

  const initialOutputCurrencyAddress = useMemo(
    () =>
      initialInputCurrencyAddress === parsedCurrencyState.outputCurrencyId // clear output if identical
        ? undefined
        : parsedCurrencyState.outputCurrencyId,
    [initialInputCurrencyAddress, parsedCurrencyState.outputCurrencyId],
  )
  const initialInputCurrency = useCurrency(initialInputCurrencyAddress, initialChainId)
  const initialOutputCurrency = useCurrency(initialOutputCurrencyAddress, initialChainId)

  return { initialInputCurrency, initialOutputCurrency, initialChainId }
}
