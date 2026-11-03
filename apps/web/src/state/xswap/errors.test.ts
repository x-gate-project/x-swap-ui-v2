import { XSwapApiError } from 'state/xswap/client'
import { getXSwapErrorMessage, parseMaxSlippageBps, toXSwapError } from 'state/xswap/errors'

describe('getXSwapErrorMessage', () => {
  it.each([
    ['unsupported_token', 'Token not supported'],
    ['no_route', 'No route for this pair'],
    ['local_unsupported', 'Same-chain swap not available on this chain'],
    ['price_unavailable', 'Price unavailable, retry'],
    ['quote_timeout', 'Quote timed out, retry'],
  ])('maps %s', (code, message) => {
    expect(getXSwapErrorMessage({ code })).toBe(message)
  })

  it('shows the max slippage from invalid_slippage', () => {
    expect(getXSwapErrorMessage({ code: 'invalid_slippage', serverMessage: 'max 300 bps for this pair' })).toBe(
      'Slippage too high (max 3%)',
    )
    expect(getXSwapErrorMessage({ code: 'invalid_slippage', serverMessage: 'max 125 bps for this pair' })).toBe(
      'Slippage too high (max 1.25%)',
    )
  })

  it('falls back when invalid_slippage has no max', () => {
    expect(getXSwapErrorMessage({ code: 'invalid_slippage' })).toBe('Slippage too high')
  })

  it('uses a generic message for other codes', () => {
    expect(getXSwapErrorMessage({ code: 'rate_limited' })).toBe('Unable to get a quote, retry')
    expect(getXSwapErrorMessage({ code: 'request_failed' })).toBe('Unable to get a quote, retry')
  })
})

describe('parseMaxSlippageBps', () => {
  it('reads the bps from the API message', () => {
    expect(parseMaxSlippageBps('max 50 bps for this pair')).toBe(50)
    expect(parseMaxSlippageBps('something else')).toBeUndefined()
    expect(parseMaxSlippageBps(undefined)).toBeUndefined()
  })
})

describe('toXSwapError', () => {
  it('keeps the API code, status and details', () => {
    const error = toXSwapError(new XSwapApiError('no_route', 404, 'no provider returned a quote', { rejected: [] }))
    expect(error).toEqual({
      code: 'no_route',
      status: 404,
      serverMessage: 'no provider returned a quote',
      details: { rejected: [] },
    })
  })

  it('wraps anything else as request_failed', () => {
    expect(toXSwapError(new Error('boom')).code).toBe('request_failed')
  })
})
