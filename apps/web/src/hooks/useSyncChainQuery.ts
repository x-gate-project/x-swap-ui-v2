import { InterfacePageName } from '@uniswap/analytics-events'
import { useAccount } from 'hooks/useAccount'
import useParsedQueryString from 'hooks/useParsedQueryString'
import useSelectChain from 'hooks/useSelectChain'
import { useEffect } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { FeatureFlags } from 'uniswap/src/features/gating/flags'
import { useFeatureFlag } from 'uniswap/src/features/gating/hooks'
import { UniverseChainId } from 'uniswap/src/types/chains'
import { getParsedChainId } from 'utils/chains'
import { getCurrentPageFromLocation } from 'utils/urlRoutes'

export default function useSyncChainQuery(chainIdRef: React.MutableRefObject<number | undefined>) {
  const account = useAccount()
  const parsedQs = useParsedQueryString()
  const multichainUXEnabled = useFeatureFlag(FeatureFlags.MultichainUX)

  const selectChain = useSelectChain()
  const [searchParams] = useSearchParams()

  const urlChainId = getParsedChainId(parsedQs)

  const { pathname } = useLocation()
  const page = getCurrentPageFromLocation(pathname)

  useEffect(() => {
    if (multichainUXEnabled || page === InterfacePageName.EXPLORE_PAGE) {
      return
    }

    // Set page/app chain to match query params
    if (urlChainId && account.chainId !== urlChainId) {
      chainIdRef.current = urlChainId
      selectChain(urlChainId)
    } else if (
      account.chainId !== (urlChainId ?? UniverseChainId.Mainnet) &&
      (searchParams.has('inputCurrency') || searchParams.has('outputCurrency'))
    ) {
      chainIdRef.current = urlChainId ?? UniverseChainId.Mainnet
      selectChain(urlChainId ?? UniverseChainId.Mainnet)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- exclude account.chainId & searchParams; don't want to trigger twice on account.chainId & urlChainId both being set
  }, [account.isConnected, chainIdRef, multichainUXEnabled, page, parsedQs, selectChain, urlChainId])

  // Note: previously this hook also synced the URL (`chain`, `inputCurrency`, `outputCurrency`
  // query params) whenever the connected wallet's chain changed. That effect is removed:
  // switching network in the wallet should not clear the currently selected sellToken/buyToken.
}

