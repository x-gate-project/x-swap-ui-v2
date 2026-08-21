import AnimatedDropdown from 'components/AnimatedDropdown'
import Column from 'components/Column'
import CurrencyLogo from 'components/Logo/CurrencyLogo'
import { RowBetween, RowFixed } from 'components/Row'
import { BridgeQuote } from 'hooks/useBridgeQuote'
import { useState } from 'react'
import { ChevronDown } from 'react-feather'
import styled, { useTheme } from 'styled-components'
import { ThemedText } from 'theme/components'
import { NumberType, useFormatter } from 'utils/formatNumbers'

const Wrapper = styled(Column)`
  border-radius: 16px;
  padding: 12px 16px;
`

const StyledHeaderRow = styled(RowBetween)<{ open: boolean }>`
  padding: 0;
  align-items: center;
  cursor: pointer;
`

const RotatingArrow = styled(ChevronDown)<{ open?: boolean }>`
  transform: ${({ open }) => (open ? 'rotate(180deg)' : 'none')};
  transition: transform 0.1s linear;
`

const DetailsWrapper = styled(Column)`
  padding-top: 12px;
  gap: 8px;
`

const LineItemRow = styled(RowBetween)`
  align-items: center;
`

const TokenAmountRow = styled(RowFixed)`
  gap: 6px;
  align-items: center;
`

interface BridgeDetailsDropdownProps {
  quote: BridgeQuote | undefined
  loading?: boolean
  label?: string
}

/**
 * Displays bridge quote details in a collapsible dropdown,
 * styled consistently with SwapDetailsDropdown.
 *
 * Shows token icons alongside amounts for input and output.
 */
export default function BridgeDetailsDropdown({ quote, loading, label }: BridgeDetailsDropdownProps) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const { formatCurrencyAmount } = useFormatter()

  return (
    <Wrapper>
      {label && (
        <ThemedText.BodySmall color={theme.neutral2} fontWeight={600} style={{ marginBottom: 4 }}>
          {label}
        </ThemedText.BodySmall>
      )}
      <StyledHeaderRow open={open} onClick={() => quote && setOpen((o) => !o)}>
        <RowFixed gap="xs" align="center">
          {quote ? (
            <>
              <CurrencyLogo currency={quote.inputCurrency} size={18} />
              <ThemedText.BodySmall color={theme.neutral1} style={{ margin: '0 2px' }}>
                {formatCurrencyAmount({ amount: quote.inputAmount, type: NumberType.SwapTradeAmount })}{' '}
                {quote.inputCurrency.symbol}
              </ThemedText.BodySmall>
              <ThemedText.BodySmall color={theme.neutral3} style={{ margin: '0 4px' }}>
                →
              </ThemedText.BodySmall>
              <CurrencyLogo currency={quote.outputCurrency} size={18} />
              <ThemedText.BodySmall color={theme.neutral1} style={{ margin: '0 2px' }}>
                {formatCurrencyAmount({ amount: quote.outputAmount, type: NumberType.SwapTradeAmount })}{' '}
                {quote.outputCurrency.symbol}
              </ThemedText.BodySmall>
            </>
          ) : loading ? (
            <ThemedText.BodySmall color={theme.neutral3}>Fetching bridge quote…</ThemedText.BodySmall>
          ) : null}
        </RowFixed>
        <RowFixed gap="xs">
          <RotatingArrow stroke={quote ? theme.neutral3 : theme.surface2} open={Boolean(quote && open)} />
        </RowFixed>
      </StyledHeaderRow>

      <AnimatedDropdown open={open && !!quote}>
        {quote && (
          <DetailsWrapper>
            <LineItemRow>
              <ThemedText.BodySmall color={theme.neutral2}>Protocol</ThemedText.BodySmall>
              <ThemedText.BodySmall>{quote.bridgeProtocol}</ThemedText.BodySmall>
            </LineItemRow>
            <LineItemRow>
              <ThemedText.BodySmall color={theme.neutral2}>Bridge input</ThemedText.BodySmall>
              <TokenAmountRow>
                <CurrencyLogo currency={quote.inputCurrency} size={16} />
                <ThemedText.BodySmall>
                  {formatCurrencyAmount({ amount: quote.inputAmount, type: NumberType.SwapTradeAmount })}{' '}
                  {quote.inputCurrency.symbol}
                </ThemedText.BodySmall>
              </TokenAmountRow>
            </LineItemRow>
            <LineItemRow>
              <ThemedText.BodySmall color={theme.neutral2}>Bridge output</ThemedText.BodySmall>
              <TokenAmountRow>
                <CurrencyLogo currency={quote.outputCurrency} size={16} />
                <ThemedText.BodySmall>
                  {formatCurrencyAmount({ amount: quote.outputAmount, type: NumberType.SwapTradeAmount })}{' '}
                  {quote.outputCurrency.symbol}
                </ThemedText.BodySmall>
              </TokenAmountRow>
            </LineItemRow>
            <LineItemRow>
              <ThemedText.BodySmall color={theme.neutral2}>Bridge fee</ThemedText.BodySmall>
              <ThemedText.BodySmall color={theme.neutral3}>~0</ThemedText.BodySmall>
            </LineItemRow>
          </DetailsWrapper>
        )}
      </AnimatedDropdown>
    </Wrapper>
  )
}
