import { t } from 'i18n'
import { XSWAP_REQUEST_FAILED, XSwapApiError } from 'state/xswap/client'

export type XSwapError = {
  code: string
  status: number
  /** Raw API message, kept for logs; never shown as is. */
  serverMessage?: string
  details?: Record<string, unknown>
}

export function toXSwapError(error: unknown): XSwapError {
  if (error instanceof XSwapApiError) {
    return { code: error.code, status: error.status, serverMessage: error.serverMessage, details: error.details }
  }
  return { code: XSWAP_REQUEST_FAILED, status: 0, serverMessage: String(error) }
}

/** `invalid_slippage` says `max <n> bps for this pair`; returns n, or undefined when the message has no number. */
export function parseMaxSlippageBps(serverMessage?: string): number | undefined {
  const match = serverMessage?.match(/max\s+(\d+)\s*bps/i)
  return match ? Number(match[1]) : undefined
}

function formatBpsAsPercent(bps: number): string {
  // 50 -> "0.5%", 300 -> "3%", 125 -> "1.25%"
  return `${Number((bps / 100).toFixed(2))}%`
}

/** User-facing message for an x-swap API error. Unknown codes get a generic message. */
export function getXSwapErrorMessage(error: Pick<XSwapError, 'code' | 'serverMessage'>): string {
  switch (error.code) {
    case 'unsupported_token':
      return t('xswap.error.unsupportedToken')
    case 'no_route':
      return t('xswap.error.noRoute')
    case 'local_unsupported':
      return t('xswap.error.localUnsupported')
    case 'invalid_slippage': {
      const maxBps = parseMaxSlippageBps(error.serverMessage)
      return maxBps === undefined
        ? t('xswap.error.invalidSlippage')
        : t('xswap.error.invalidSlippage.max', { max: formatBpsAsPercent(maxBps) })
    }
    case 'price_unavailable':
      return t('xswap.error.priceUnavailable')
    case 'quote_timeout':
      return t('xswap.error.quoteTimeout')
    default:
      return t('xswap.error.generic')
  }
}
