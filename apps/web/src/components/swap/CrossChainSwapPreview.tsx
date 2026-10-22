import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import Column, { AutoColumn } from 'components/Column'
import { SwapModalHeaderAmount } from 'components/swap/SwapModalHeaderAmount'
import { Field } from 'components/swap/constants'
import { useUSDPrice } from 'hooks/useUSDPrice'
import { Trans } from 'i18n'
import styled from 'styled-components'

const HeaderContainer = styled(AutoColumn)`
  margin-top: 0px;
`

export function CrossChainSwapPreview({
  inputCurrency,
  outputCurrency,
  inputAmount,
  outputAmount,
}: {
  inputCurrency?: Currency | null
  outputCurrency?: Currency | null
  inputAmount?: CurrencyAmount<Currency>
  outputAmount?: CurrencyAmount<Currency>
}) {
  const fiatValueInput = useUSDPrice(inputAmount)
  const fiatValueOutput = useUSDPrice(outputAmount)

  const resolvedInputCurrency = inputCurrency ?? inputAmount?.currency
  const resolvedOutputCurrency = outputCurrency ?? outputAmount?.currency

  return (
    <HeaderContainer gap="sm">
      <Column gap="lg">
        {inputAmount && resolvedInputCurrency && (
          <SwapModalHeaderAmount
            field={Field.INPUT}
            label={<Trans i18nKey="common.sell.label" />}
            amount={inputAmount}
            currency={resolvedInputCurrency}
            usdAmount={fiatValueInput.data}
            isLoading={false}
          />
        )}
        {outputAmount && resolvedOutputCurrency ? (
          <SwapModalHeaderAmount
            field={Field.OUTPUT}
            label={<Trans i18nKey="common.buy.label" />}
            amount={outputAmount}
            currency={resolvedOutputCurrency}
            usdAmount={fiatValueOutput.data}
            isLoading={false}
          />
        ) : (
          <SwapModalHeaderAmount
            field={Field.OUTPUT}
            label={<Trans i18nKey="common.buy.label" />}
            amount={inputAmount ?? ({ currency: resolvedInputCurrency } as any)}
            currency={resolvedOutputCurrency ?? resolvedInputCurrency!}
            usdAmount={undefined}
            isLoading={true}
          />
        )}
      </Column>
    </HeaderContainer>
  )
}
