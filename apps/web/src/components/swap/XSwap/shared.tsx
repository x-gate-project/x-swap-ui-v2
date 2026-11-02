import { XSwapTokenLookup, useXSwapChains } from 'state/xswap/hooks'
import { XSwapQuote } from 'state/xswap/types'
import { formatXSwapUnits, isXSwapNativeAddress, shortenXSwapHash, xswapExplorerTxUrl } from 'state/xswap/utils'
import styled from 'styled-components'
import { ExternalLink } from 'theme/components'
import { UNIVERSE_CHAIN_INFO } from 'uniswap/src/constants/chains'
import { InterfaceChainId } from 'uniswap/src/types/chains'

export const Card = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid ${({ theme }) => theme.surface3};
  background: ${({ theme }) => theme.surface1};
`

export const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`

export const Muted = styled.span`
  color: ${({ theme }) => theme.neutral2};
  font-size: 12px;
  line-height: 16px;
`

export const Label = styled.span`
  color: ${({ theme }) => theme.neutral1};
  font-size: 14px;
  line-height: 20px;
  font-weight: 485;
`

export const Badge = styled.span<{ $tone?: 'accent' | 'neutral' | 'critical' | 'success' }>`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 535;
  white-space: nowrap;
  color: ${({ theme, $tone }) =>
    $tone === 'accent'
      ? theme.accent1
      : $tone === 'critical'
        ? theme.critical
        : $tone === 'success'
          ? theme.success
          : theme.neutral2};
  background: ${({ theme, $tone }) =>
    $tone === 'accent' ? theme.accent2 : $tone === 'critical' ? theme.critical2 : theme.surface2};
`

export const ErrorText = styled.div`
  color: ${({ theme }) => theme.critical};
  font-size: 14px;
  line-height: 20px;
  overflow-wrap: anywhere;
`

/** Chain name from `GET /v1/chains`, then the app's chain list, then the id. */
export function useXSwapChainName(): (chainId: number) => string {
  const { chains } = useXSwapChains()
  return (chainId: number) =>
    chains.find((c) => c.chainId === chainId)?.name ??
    UNIVERSE_CHAIN_INFO[chainId as InterfaceChainId]?.label ??
    `Chain ${chainId}`
}

/** Native symbol of a chain from `GET /v1/chains`. */
export function useXSwapNativeSymbol(): (chainId: number) => string {
  const { chains } = useXSwapChains()
  return (chainId: number) =>
    chains.find((c) => c.chainId === chainId)?.nativeSymbol ??
    UNIVERSE_CHAIN_INFO[chainId as InterfaceChainId]?.nativeCurrency.symbol ??
    'ETH'
}

/** `amount` of a token in its own units with its symbol; raw base units when the API does not list the token. */
export function formatXSwapTokenAmount(
  lookup: XSwapTokenLookup,
  nativeSymbol: (chainId: number) => string,
  chainId: number,
  address: string,
  amount: string,
): string {
  const token = lookup(chainId, address)
  if (token) {
    return `${formatXSwapUnits(amount, token.decimals)} ${token.symbol}`
  }
  if (isXSwapNativeAddress(address)) {
    return `${formatXSwapUnits(amount, 18)} ${nativeSymbol(chainId)}`
  }
  return `${amount} (${shortenXSwapHash(address)})`
}

export function TxLink({ chainId, hash }: { chainId: number; hash: string }) {
  const explorer = UNIVERSE_CHAIN_INFO[chainId as InterfaceChainId]?.explorer.url
  const href = xswapExplorerTxUrl(chainId, hash, explorer)
  const label = shortenXSwapHash(hash, 6)
  return href ? <ExternalLink href={href}>{label}</ExternalLink> : <span>{label}</span>
}

const PROVIDER_NAMES: Record<string, string> = {
  across: 'Across',
  relay: 'Relay',
  xgate: 'X-Gate',
  xswap: 'X-Swap',
  uniswap: 'Uniswap',
}

export function xswapProviderName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider
}

/** `best` first, then the other candidates (the API ranks them best first and may repeat `best` among them). */
export function xswapRoutes(best: XSwapQuote, candidates: XSwapQuote[]): XSwapQuote[] {
  return [best, ...candidates.filter((q) => q.quoteId !== best.quoteId)]
}
