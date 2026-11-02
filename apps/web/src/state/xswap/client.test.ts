import fetch from 'jest-fetch-mock'
import { XSwapApiError, getXSwapChains, getXSwapQuote, getXSwapTokens, isXSwapApiEnabled } from 'state/xswap/client'

fetch.enableMocks()

const BASE = 'https://xswap.test/v1'

describe('x-swap API client', () => {
  const originalUrl = process.env.REACT_APP_XSWAP_API_URL

  beforeEach(() => {
    process.env.REACT_APP_XSWAP_API_URL = `${BASE}/`
    fetch.resetMocks()
  })

  afterAll(() => {
    process.env.REACT_APP_XSWAP_API_URL = originalUrl
  })

  it('is disabled without a base URL', () => {
    process.env.REACT_APP_XSWAP_API_URL = ''
    expect(isXSwapApiEnabled()).toBe(false)
    process.env.REACT_APP_XSWAP_API_URL = BASE
    expect(isXSwapApiEnabled()).toBe(true)
  })

  it('loads chains', async () => {
    fetch.mockResponseOnce(
      JSON.stringify({ chains: [{ chainId: 1, name: 'Ethereum', nativeSymbol: 'ETH', wrappedNative: '0x1' }] }),
    )
    await expect(getXSwapChains()).resolves.toEqual([
      { chainId: 1, name: 'Ethereum', nativeSymbol: 'ETH', wrappedNative: '0x1' },
    ])
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/chains`)
  })

  it('loads tokens for a chain', async () => {
    fetch.mockResponseOnce(JSON.stringify({ tokens: [] }))
    await expect(getXSwapTokens(81)).resolves.toEqual([])
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/tokens?chainId=81`)
  })

  it('posts the quote request', async () => {
    const response = { requestId: 'r', routeClass: 'local', best: {}, candidates: [], rejected: [] }
    fetch.mockResponseOnce(JSON.stringify(response))
    const params = {
      tokenIn: '0x0000000000000000000000000000000000000000',
      tokenInChainId: 1,
      tokenOut: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      tokenOutChainId: 1,
      amount: '1',
      swapper: '0x0000000000000000000000000000000000000001',
    }
    await expect(getXSwapQuote(params)).resolves.toEqual(response)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${BASE}/quote`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual(params)
  })

  it('throws the error envelope as XSwapApiError', async () => {
    fetch.mockResponseOnce(
      JSON.stringify({ code: 'local_unsupported', message: 'no source', requestId: 'r', details: { x: 1 } }),
      { status: 422 },
    )
    const error = await getXSwapChains().catch((e) => e)
    expect(error).toBeInstanceOf(XSwapApiError)
    expect(error.code).toBe('local_unsupported')
    expect(error.status).toBe(422)
    expect(error.details).toEqual({ x: 1 })
  })

  it('falls back to the HTTP status when the body is not an envelope', async () => {
    fetch.mockResponseOnce('bad gateway', { status: 502 })
    const error = await getXSwapChains().catch((e) => e)
    expect(error.code).toBe('http_502')
  })

  it('reports a network failure as request_failed', async () => {
    fetch.mockRejectOnce(new Error('offline'))
    const error = await getXSwapChains().catch((e) => e)
    expect(error).toBeInstanceOf(XSwapApiError)
    expect(error.code).toBe('request_failed')
  })
})
