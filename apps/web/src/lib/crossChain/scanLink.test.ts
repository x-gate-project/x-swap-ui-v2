import { getXGateScanEnv, getXGateScanTxLink } from 'lib/crossChain/scanLink'
import { UniverseChainId } from 'uniswap/src/types/chains'

describe('getXGateScanEnv', () => {
  it('maps chain to scan env', () => {
    expect(getXGateScanEnv(UniverseChainId.Sepolia)).toEqual('testnet')
    expect(getXGateScanEnv(UniverseChainId.Mainnet)).toEqual('mainnet')
  })
})

describe('getXGateScanTxLink', () => {
  it('uses testnet scan for testnet chains', () => {
    expect(getXGateScanTxLink(UniverseChainId.Sepolia, '0xabc')).toEqual('https://scan.testnet.x-gate.org/tx/0xabc')
    expect(getXGateScanTxLink(UniverseChainId.JocTestnet, '0xabc')).toEqual('https://scan.testnet.x-gate.org/tx/0xabc')
  })

  it('uses mainnet scan for mainnet chains', () => {
    expect(getXGateScanTxLink(UniverseChainId.Mainnet, '0xabc')).toEqual('https://scan.x-gate.org/tx/0xabc')
    expect(getXGateScanTxLink(UniverseChainId.JocMainnet, '0xabc')).toEqual('https://scan.x-gate.org/tx/0xabc')
  })
})
