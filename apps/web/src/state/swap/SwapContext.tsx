import { Currency } from '@uniswap/sdk-core'
import { useAccount } from 'hooks/useAccount'
import usePrevious from 'hooks/usePrevious'
import { PropsWithChildren, useEffect, useMemo, useState } from 'react'

import { useDerivedSwapInfo } from 'state/swap/hooks'
import { CurrencyState, SwapAndLimitContext, SwapContext, SwapState, initialSwapState } from 'state/swap/types'
import { InterfaceChainId } from 'uniswap/src/types/chains'
import { SwapTab } from 'uniswap/src/types/screens/interface'

export function SwapAndLimitContextProvider({
  children,
  initialChainId,
  initialInputCurrency,
  initialOutputCurrency,
  multichainUXEnabled,
}: PropsWithChildren<{
  initialChainId?: InterfaceChainId
  initialInputCurrency?: Currency
  initialOutputCurrency?: Currency
  multichainUXEnabled?: boolean
}>) {
  const [selectedChainId, setSelectedChainId] = useState<InterfaceChainId | undefined | null>(initialChainId)
  const [currentTab, setCurrentTab] = useState<SwapTab>(SwapTab.Swap)

  const [currencyState, setCurrencyState] = useState<CurrencyState>({
    inputCurrency: initialInputCurrency,
    outputCurrency: initialOutputCurrency,
  })

  const prefilledState = useMemo(
    () => ({
      inputCurrency: initialInputCurrency,
      outputCurrency: initialOutputCurrency,
    }),
    [initialInputCurrency, initialOutputCurrency],
  )

  const account = useAccount()
  const previousInitialInputCurrency = usePrevious(initialInputCurrency)
  const previousInitialOutputCurrency = usePrevious(initialOutputCurrency)

  useEffect(() => {
    if (!multichainUXEnabled) {
      return
    }

    if (previousInitialInputCurrency && previousInitialInputCurrency !== initialInputCurrency) {
      setCurrencyState((prev) => ({ ...prev, inputCurrency: initialInputCurrency }))
    }
  }, [
    multichainUXEnabled,
    initialInputCurrency,
    initialOutputCurrency,
    previousInitialInputCurrency,
    previousInitialOutputCurrency,
  ])

  const previousPrefilledState = usePrevious(prefilledState)

  useEffect(() => {
    // Cross-chain: wallet network can now change independently of sellToken/buyToken
    // (user switches network via navbar ChainSelector, or wallet silently switches during
    // cross-chain swap execution). Neither case should reset the currently selected tokens —
    // only an actual change to prefilled (URL/prop) currencies should reset the form.
    const combinedCurrencyState = { ...currencyState, ...prefilledState }
    const prefilledInputChanged = Boolean(
      previousPrefilledState?.inputCurrency
        ? !prefilledState.inputCurrency?.equals(previousPrefilledState.inputCurrency)
        : prefilledState.inputCurrency,
    )
    const prefilledOutputChanged = Boolean(
      previousPrefilledState?.outputCurrency
        ? !prefilledState?.outputCurrency?.equals(previousPrefilledState.outputCurrency)
        : prefilledState.outputCurrency,
    )

    if (prefilledInputChanged || prefilledOutputChanged) {
      setCurrencyState({
        inputCurrency: combinedCurrencyState.inputCurrency ?? undefined,
        outputCurrency: combinedCurrencyState.outputCurrency ?? undefined,
      })
    }
  }, [currencyState, prefilledState, previousPrefilledState])

  useEffect(() => {
    if (initialChainId) {
      setSelectedChainId(initialChainId)
    }
  }, [initialChainId, setSelectedChainId])

  const globalChainId = (multichainUXEnabled ? selectedChainId : account.chainId) ?? undefined

  const value = useMemo(() => {
    // Per-field chain IDs derived from the selected currency.
    // Falls back to globalChainId so non-swap usages still work.
    const inputChainId = (currencyState.inputCurrency?.chainId ?? globalChainId) as typeof globalChainId
    const outputChainId = (currencyState.outputCurrency?.chainId ?? globalChainId) as typeof globalChainId
    return {
      currencyState,
      setCurrencyState,
      setSelectedChainId,
      currentTab,
      setCurrentTab,
      prefilledState,
      initialChainId,
      chainId: globalChainId,
      inputChainId,
      outputChainId,
      multichainUXEnabled,
      isSwapAndLimitContext: true,
    }
  }, [
    initialChainId,
    account.chainId,
    selectedChainId,
    currencyState,
    currentTab,
    prefilledState,
    multichainUXEnabled,
    globalChainId,
  ])

  return <SwapAndLimitContext.Provider value={value}>{children}</SwapAndLimitContext.Provider>
}

export function SwapContextProvider({ children }: { multichainUXEnabled?: boolean; children: React.ReactNode }) {
  const [swapState, setSwapState] = useState<SwapState>({
    ...initialSwapState,
  })
  const derivedSwapInfo = useDerivedSwapInfo(swapState)

  // Cross-chain: wallet network switches independently of sellToken/buyToken now, so the
  // typed amount is no longer cleared on network change (navbar ChainSelector, or wallet
  // silently switching during cross-chain swap execution).

  return <SwapContext.Provider value={{ swapState, setSwapState, derivedSwapInfo }}>{children}</SwapContext.Provider>
}
