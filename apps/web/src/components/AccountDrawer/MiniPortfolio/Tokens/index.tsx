import { InterfaceElementName } from '@uniswap/analytics-events'
import { ExpandoRow } from 'components/AccountDrawer/MiniPortfolio/ExpandoRow'
import { PortfolioLogo } from 'components/AccountDrawer/MiniPortfolio/PortfolioLogo'
import PortfolioRow, {
  PortfolioSkeleton,
  PortfolioTabWrapper,
} from 'components/AccountDrawer/MiniPortfolio/PortfolioRow'
import { useAccountDrawer } from 'components/AccountDrawer/MiniPortfolio/hooks'
import { hideSmallBalancesAtom } from 'components/AccountDrawer/SmallBalanceToggle'
import { hideSpamAtom } from 'components/AccountDrawer/SpamToggle'
import { showTestnetsAtom } from 'components/AccountDrawer/TestnetsToggle'
import Row from 'components/Row'
import { DeltaArrow } from 'components/Tokens/TokenDetails/Delta'
import { SupportedInterfaceChainId, TESTNET_CHAIN_IDS, getChain, isSupportedChainId } from 'constants/chains'
import { COMMON_BASES } from 'constants/routing'
import { useTokenBalancesQuery } from 'graphql/data/apollo/TokenBalancesProvider'
import { PortfolioToken } from 'graphql/data/portfolios'
import { getTokenDetailsURL, gqlToCurrency } from 'graphql/data/util'
import { useAccount } from 'hooks/useAccount'
import { useCrossChainCurrencyBalances } from 'hooks/useCrossChainCurrencyBalances'
import { useAtomValue } from 'jotai/utils'
import { EmptyWalletModule } from 'nft/components/profile/view/EmptyWalletContent'
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { EllipsisStyle, ThemedText } from 'theme/components'
import { PortfolioTokenBalancePartsFragment } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import Trace from 'uniswap/src/features/telemetry/Trace'
import { logger } from 'utilities/src/logger/logger'
import { currencyKey } from 'utils/currencyKey'
import { NumberType, useFormatter } from 'utils/formatNumbers'
import { splitHiddenTokens } from 'utils/splitHiddenTokens'

export default function Tokens() {
  const accountDrawer = useAccountDrawer()
  const hideSmallBalances = useAtomValue(hideSmallBalancesAtom)
  const hideSpam = useAtomValue(hideSpamAtom)
  const [showHiddenTokens, setShowHiddenTokens] = useState(false)

  const { data } = useTokenBalancesQuery({ cacheOnly: !accountDrawer.isOpen })
  const testnetMode = useAtomValue(showTestnetsAtom)

  const tokenBalances = data?.portfolios?.[0]?.tokenBalances

  const { visibleTokens, hiddenTokens } = useMemo(
    () => splitHiddenTokens(tokenBalances ?? [], { hideSmallBalances, hideSpam }),
    [hideSmallBalances, tokenBalances, hideSpam],
  )

  if (testnetMode) {
    return <TestnetTokens />
  }

  if (!data) {
    return <PortfolioSkeleton />
  }

  if (tokenBalances?.length === 0) {
    // TODO: consider launching moonpay here instead of just closing the drawer
    return <EmptyWalletModule type="token" onNavigateClick={accountDrawer.close} />
  }

  const toggleHiddenTokens = () => setShowHiddenTokens((showHiddenTokens) => !showHiddenTokens)

  return (
    <PortfolioTabWrapper>
      {visibleTokens.map(
        (tokenBalance) =>
          tokenBalance.token && <TokenRow key={tokenBalance.id} {...tokenBalance} token={tokenBalance.token} />,
      )}
      <ExpandoRow isExpanded={showHiddenTokens} toggle={toggleHiddenTokens} numItems={hiddenTokens.length}>
        {hiddenTokens.map(
          (tokenBalance) =>
            tokenBalance.token && <TokenRow key={tokenBalance.id} {...tokenBalance} token={tokenBalance.token} />,
        )}
      </ExpandoRow>
    </PortfolioTabWrapper>
  )
}

// ponytail: only COMMON_BASES tokens of visible testnet chains; add user-added/token-list tokens when needed.
const TESTNET_CURRENCIES = TESTNET_CHAIN_IDS.filter(isSupportedChainId).flatMap((chainId) =>
  (COMMON_BASES[chainId] ?? []).map((info) => info.currency),
)

/** Testnet mode: balances read on-chain (backend has no testnet portfolios), USD value always $0. */
function TestnetTokens() {
  const accountDrawer = useAccountDrawer()
  const account = useAccount()
  const { formatNumber } = useFormatter()
  const balances = useCrossChainCurrencyBalances(accountDrawer.isOpen ? account.address : undefined, TESTNET_CURRENCIES)

  if (balances.every((balance) => balance === undefined)) {
    return <PortfolioSkeleton />
  }

  const nonZero = balances.filter((balance) => balance?.greaterThan(0))
  if (nonZero.length === 0) {
    return <EmptyWalletModule type="token" onNavigateClick={accountDrawer.close} />
  }

  return (
    <PortfolioTabWrapper>
      {nonZero.map(
        (balance) =>
          balance && (
            <PortfolioRow
              key={currencyKey(balance.currency)}
              left={<PortfolioLogo chainId={balance.currency.chainId} currencies={[balance.currency]} size={40} />}
              title={
                <TokenNameText>
                  {/* ExtendedEther names every ETH "Ethereum"; prefix chain label to tell testnets apart. */}
                  {balance.currency.isNative
                    ? `${getChain({ chainId: balance.currency.chainId as SupportedInterfaceChainId }).label} ${balance.currency.symbol}`
                    : balance.currency.name}
                </TokenNameText>
              }
              descriptor={
                <TokenBalanceText>
                  {formatNumber({ input: Number(balance.toExact()), type: NumberType.TokenNonTx })}{' '}
                  {balance.currency.symbol}
                </TokenBalanceText>
              }
              right={
                <ThemedText.SubHeader>
                  {formatNumber({ input: 0, type: NumberType.PortfolioBalance })}
                </ThemedText.SubHeader>
              }
            />
          ),
      )}
    </PortfolioTabWrapper>
  )
}

const TokenBalanceText = styled(ThemedText.BodySecondary)`
  ${EllipsisStyle}
`
const TokenNameText = styled(ThemedText.SubHeader)`
  ${EllipsisStyle}
`

function TokenRow({
  token,
  quantity,
  denominatedValue,
  tokenProjectMarket,
}: PortfolioTokenBalancePartsFragment & { token: PortfolioToken }) {
  const { formatDelta } = useFormatter()
  const percentChange = tokenProjectMarket?.pricePercentChange?.value ?? 0

  const navigate = useNavigate()
  const accountDrawer = useAccountDrawer()

  const navigateToTokenDetails = useCallback(async () => {
    navigate(getTokenDetailsURL({ ...token }))
    accountDrawer.close()
  }, [navigate, token, accountDrawer])
  const { formatNumber } = useFormatter()

  const currency = gqlToCurrency(token)
  if (!currency) {
    logger.error(new Error('Token from unsupported chain received from Mini Portfolio Token Balance Query'), {
      tags: {
        file: 'RecentlySearchedAssets',
        function: 'useRecentlySearchedAssets',
      },
      extra: { token },
    })
    return null
  }
  return (
    <Trace
      logPress
      element={InterfaceElementName.MINI_PORTFOLIO_TOKEN_ROW}
      properties={{
        chain_id: currency.chainId,
        token_name: token?.project?.name ?? token?.name,
        address: token?.address,
      }}
    >
      <PortfolioRow
        left={<PortfolioLogo chainId={currency.chainId} currencies={[currency]} size={40} />}
        title={<TokenNameText>{token?.project?.name ?? token?.name}</TokenNameText>}
        descriptor={
          <TokenBalanceText>
            {formatNumber({
              input: quantity,
              type: NumberType.TokenNonTx,
            })}{' '}
            {token?.symbol}
          </TokenBalanceText>
        }
        onClick={navigateToTokenDetails}
        right={
          denominatedValue && (
            <>
              <ThemedText.SubHeader>
                {formatNumber({
                  input: denominatedValue?.value,
                  type: NumberType.PortfolioBalance,
                })}
              </ThemedText.SubHeader>
              <Row justify="flex-end">
                <DeltaArrow delta={percentChange} />
                <ThemedText.BodySecondary>{formatDelta(percentChange)}</ThemedText.BodySecondary>
              </Row>
            </>
          )
        }
      />
    </Trace>
  )
}
