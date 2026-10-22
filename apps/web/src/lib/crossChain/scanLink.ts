import { SupportedInterfaceChainId, TESTNET_CHAIN_IDS } from 'constants/chains'

const XGATE_SCAN_URL = {
  testnet: 'https://scan.testnet.x-gate.org',
  mainnet: 'https://scan.x-gate.org',
}

export function getXGateScanEnv(srcChainId: number): keyof typeof XGATE_SCAN_URL {
  return TESTNET_CHAIN_IDS.includes(srcChainId as SupportedInterfaceChainId) ? 'testnet' : 'mainnet'
}

/** X-Gate Scan (LayerZero message explorer) link for a src-chain tx hash. */
export function getXGateScanTxLink(srcChainId: number, hash: string): string {
  return `${XGATE_SCAN_URL[getXGateScanEnv(srcChainId)]}/tx/${hash}`
}
