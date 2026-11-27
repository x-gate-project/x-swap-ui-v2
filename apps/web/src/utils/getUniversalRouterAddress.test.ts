import { UNIVERSAL_ROUTER_ADDRESS } from '@uniswap/universal-router-sdk'
import { UniverseChainId } from 'uniswap/src/types/chains'
import { getUniversalRouterAddress } from 'utils/getUniversalRouterAddress'

describe('getUniversalRouterAddress', () => {
  it('returns the SDK address on a chain with a Universal Router', () => {
    expect(getUniversalRouterAddress(UniverseChainId.Mainnet)).toBe(UNIVERSAL_ROUTER_ADDRESS(UniverseChainId.Mainnet))
    expect(getUniversalRouterAddress(UniverseChainId.Sepolia)).toBe(UNIVERSAL_ROUTER_ADDRESS(UniverseChainId.Sepolia))
  })

  it('returns undefined on a chain the SDK does not know, where UNIVERSAL_ROUTER_ADDRESS throws', () => {
    expect(() => UNIVERSAL_ROUTER_ADDRESS(UniverseChainId.ArbitrumSepolia)).toThrow('Universal Router not deployed')
    expect(getUniversalRouterAddress(UniverseChainId.ArbitrumSepolia)).toBeUndefined()
    expect(getUniversalRouterAddress(UniverseChainId.BaseSepolia)).toBeUndefined()
  })

  it('returns undefined without a chain', () => {
    expect(getUniversalRouterAddress(undefined)).toBeUndefined()
  })
})
