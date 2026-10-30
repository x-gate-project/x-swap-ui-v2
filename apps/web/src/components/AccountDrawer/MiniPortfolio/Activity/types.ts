import { Currency } from '@uniswap/sdk-core'
import { UniswapXOrderDetails } from 'state/signatures/types'
import { TransactionStatus } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { InterfaceChainId } from 'uniswap/src/types/chains'

/**
 * TODO: refactor parsing / Activity so that all Activity Types can have a detail sheet.
 */

export type Activity = {
  hash: string
  chainId: InterfaceChainId
  /** Destination chain for BRIDGE / CROSS_CHAIN_SWAP */
  dstChainId?: InterfaceChainId
  status: TransactionStatus
  offchainOrderDetails?: UniswapXOrderDetails
  statusMessage?: string
  timestamp: number
  title: string
  descriptor?: string
  logos?: Array<string | undefined>
  // TODO(WEB-3839): replace Currency with CurrencyInfo
  currencies?: Array<Currency | undefined>
  otherAccount?: string
  from: string
  nonce?: number | null
  prefixIconSrc?: string
  suffixIconSrc?: string
  cancelled?: boolean
  isSpam?: boolean
  /** Overrides the default chain explorer link (e.g. X-Gate Scan for LayerZero bridge txs) */
  explorerUrl?: string
}

export type ActivityMap = { [id: string]: Activity | undefined }
