import 'test-utils/tokens/mocks'

import { transactionToActivity } from 'components/AccountDrawer/MiniPortfolio/Activity/parseLocal'
import { DAI, USDC_MAINNET } from 'constants/tokens'
import { TransactionDetails, TransactionType } from 'state/transactions/types'
import { TransactionStatus } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { UniverseChainId } from 'uniswap/src/types/chains'

const formatNumber = (({ input }: { input: number }) => input.toFixed(2)) as Parameters<
  typeof transactionToActivity
>[2]

const deposit = (routeClass: string, status: TransactionStatus): TransactionDetails =>
  ({
    hash: '0xdeposit',
    from: '0x0000000000000000000000000000000000000001',
    addedTime: 0,
    confirmedTime: 0,
    status,
    info: {
      type: TransactionType.XSWAP_DEPOSIT,
      quoteId: 'q1',
      routeClass,
      inputChainId: UniverseChainId.Mainnet,
      inputCurrencyId: USDC_MAINNET.address,
      inputCurrencyAmountRaw: '1000000',
      outputChainId: UniverseChainId.Mainnet,
      outputCurrencyId: DAI.address,
      expectedOutputCurrencyAmountRaw: '1000000000000000000',
    },
  }) as TransactionDetails

describe('transactionToActivity: x-swap deposit', () => {
  it.each([
    ['evm-native', TransactionStatus.Pending, 'Sending cross-chain swap'],
    ['evm-native', TransactionStatus.Confirmed, 'Cross-chain swap sent'],
    ['evm-native', TransactionStatus.Failed, 'Cross-chain swap failed'],
    ['local', TransactionStatus.Pending, 'Swapping'],
    ['local', TransactionStatus.Confirmed, 'Swapped'],
  ])('titles a %s deposit that is %s', async (routeClass, status, title) => {
    expect(await transactionToActivity(deposit(routeClass, status), UniverseChainId.Mainnet, formatNumber)).toMatchObject(
      {
        hash: '0xdeposit',
        title,
        status,
        currencies: [USDC_MAINNET, DAI],
        descriptor: `1.00 ${USDC_MAINNET.symbol} for 1.00 ${DAI.symbol}`,
      },
    )
  })
})
