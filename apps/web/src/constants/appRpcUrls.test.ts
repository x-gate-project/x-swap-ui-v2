import { getAppRpcUrls } from 'constants/appRpcUrls'

const CHAIN_RPC_URLS = ['https://chain.test/a', 'https://chain.test/b'] as const

describe('getAppRpcUrls', () => {
  const originalTemplate = process.env.REACT_APP_RPC_URL_TEMPLATE

  afterEach(() => {
    if (originalTemplate === undefined) {
      delete process.env.REACT_APP_RPC_URL_TEMPLATE
    } else {
      process.env.REACT_APP_RPC_URL_TEMPLATE = originalTemplate
    }
  })

  it("returns the chain's own RPCs without a template", () => {
    delete process.env.REACT_APP_RPC_URL_TEMPLATE
    expect(getAppRpcUrls(11155111, CHAIN_RPC_URLS)).toEqual([...CHAIN_RPC_URLS])

    process.env.REACT_APP_RPC_URL_TEMPLATE = ''
    expect(getAppRpcUrls(11155111, CHAIN_RPC_URLS)).toEqual([...CHAIN_RPC_URLS])
  })

  it("puts the template's RPC first and keeps the chain's own as fallbacks", () => {
    process.env.REACT_APP_RPC_URL_TEMPLATE = 'https://rpc.test/evm/{chainId}'
    expect(getAppRpcUrls(11155111, CHAIN_RPC_URLS)).toEqual(['https://rpc.test/evm/11155111', ...CHAIN_RPC_URLS])
    expect(getAppRpcUrls(10081, [])).toEqual(['https://rpc.test/evm/10081'])
  })

  it('ignores a template without the placeholder', () => {
    process.env.REACT_APP_RPC_URL_TEMPLATE = 'https://rpc.test/evm'
    expect(getAppRpcUrls(11155111, CHAIN_RPC_URLS)).toEqual([...CHAIN_RPC_URLS])
  })
})
