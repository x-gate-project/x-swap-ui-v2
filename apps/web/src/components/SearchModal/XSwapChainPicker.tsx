import { ChainLogo } from 'components/Logo/ChainLogo'
import { useXSwapChains } from 'state/xswap/hooks'
import styled from 'styled-components'
import { InterfaceChainId } from 'uniswap/src/types/chains'

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const Chip = styled.button<{ $selected: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 16px;
  border: 1px solid ${({ theme, $selected }) => ($selected ? theme.accent1 : theme.surface3)};
  background: ${({ theme, $selected }) => ($selected ? theme.accent2 : theme.surface1)};
  color: ${({ theme }) => theme.neutral1};
  font-size: 14px;
  font-weight: 485;
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.surface2};
  }
`

/** Chains `GET /v1/chains` enables, to pick the chain of a cross-chain swap's output without switching the wallet. */
export function XSwapChainPicker({
  selectedChainId,
  onSelect,
}: {
  selectedChainId?: number
  onSelect: (chainId: number) => void
}) {
  const { chains } = useXSwapChains()
  if (chains.length === 0) {
    return null
  }
  return (
    <Chips role="radiogroup" data-testid="xswap-chain-picker">
      {chains.map((chain) => (
        <Chip
          key={chain.chainId}
          type="button"
          role="radio"
          aria-checked={chain.chainId === selectedChainId}
          $selected={chain.chainId === selectedChainId}
          onClick={() => onSelect(chain.chainId)}
        >
          <ChainLogo chainId={chain.chainId as InterfaceChainId} size={16} />
          {chain.name}
        </Chip>
      ))}
    </Chips>
  )
}
