import { Page } from '@playwright/test'
import { numberToHex } from 'viem'

import { MockChain } from './mockChain'
import { RpcError, handleRpc } from './rpc'

type WalletRequest = { method: string; params?: unknown[] }
type WalletResponse = { result?: unknown; error?: { code: number; message: string }; chainChanged?: string }

// Any well-formed 65-byte signature: the stubbed API never checks it.
const SIGNATURE = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b`

/** Answers the wallet's requests in Node, from the same MockChain the RPC stub reads. */
function handleWalletRequest(chain: MockChain, { method, params = [] }: WalletRequest): WalletResponse {
  try {
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return { result: [chain.account] }
      case 'wallet_requestPermissions':
      case 'wallet_getPermissions':
        return { result: [{ parentCapability: 'eth_accounts' }] }
      case 'wallet_switchEthereumChain': {
        chain.chainId = Number((params[0] as { chainId: string }).chainId)
        return { result: null, chainChanged: numberToHex(chain.chainId) }
      }
      case 'wallet_addEthereumChain':
        return { result: null }
      case 'eth_sendTransaction':
        if (chain.takeRejection(method)) {
          return { error: { code: 4001, message: 'User rejected the request.' } }
        }
        return { result: chain.sendTransaction(params[0] as { to: string; data?: string; value?: string }) }
      case 'eth_signTypedData_v4':
      case 'personal_sign':
        if (chain.takeRejection(method)) {
          return { error: { code: 4001, message: 'User rejected the request.' } }
        }
        chain.signatures.push({ method, params })
        return { result: SIGNATURE }
    }
    // Reads the wallet client makes itself (gas, nonce, fees) go to the stubbed chain.
    return { result: handleRpc(chain, chain.chainId, method, params) }
  } catch (e) {
    const error = e instanceof RpcError ? e : new RpcError(-32603, String(e))
    return { error: { code: error.code, message: error.message } }
  }
}

/**
 * Injects an EIP-1193 provider as `window.ethereum` and asks the app to connect to it on load (`__XSWAP_E2E__`, read in
 * `src/components/Web3Provider/wagmi.ts`). Its requests are answered in Node through an exposed binding.
 */
export async function installWallet(page: Page, chain: MockChain) {
  await page.exposeFunction('__e2eWalletRequest', (request: WalletRequest) => handleWalletRequest(chain, request))
  await page.addInitScript(
    ({ chainId }) => {
      type Listener = (...args: unknown[]) => void
      const listeners = new Map<string, Set<Listener>>()
      const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((fn) => fn(...args))
      const request = (window as unknown as { __e2eWalletRequest: (r: unknown) => Promise<WalletResponse> })
        .__e2eWalletRequest
      const provider = {
        isMetaMask: false,
        chainId: chainId as string,
        async request({ method, params }: { method: string; params?: unknown[] }) {
          const response = await request({ method, params })
          if (response.error) {
            throw Object.assign(new Error(response.error.message), { code: response.error.code })
          }
          if (response.chainChanged) {
            provider.chainId = response.chainChanged
            emit('chainChanged', response.chainChanged)
          }
          return response.result
        },
        on(event: string, fn: Listener) {
          listeners.set(event, (listeners.get(event) ?? new Set()).add(fn))
          return provider
        },
        removeListener(event: string, fn: Listener) {
          listeners.get(event)?.delete(fn)
          return provider
        },
      }
      Object.assign(window, { ethereum: provider, __XSWAP_E2E__: { eagerlyConnect: true } })
    },
    { chainId: numberToHex(chain.chainId) },
  )
}
