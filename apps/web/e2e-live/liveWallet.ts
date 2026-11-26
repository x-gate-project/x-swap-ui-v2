import { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { Chain, Hex, createWalletClient, http, numberToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrumSepolia, sepolia } from 'viem/chains'

type WalletRequest = { method: string; params?: unknown[] }
type WalletResponse = { result?: unknown; error?: { code: number; message: string }; chainChanged?: string }
type SentTx = { chainId: number; hash: Hex; to: string; value: bigint }

function loadEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) {
      env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return env
}

/**
 * A real EIP-1193 wallet for a live run: signs with the key in LIVE_ENV_FILE (`KEY`, `RPC_SEPOLIA`) and sends to the
 * testnets. Reads the app's wallet client makes itself go to the same RPCs.
 */
export function liveWallet(initialChainId: number = sepolia.id) {
  if (!process.env.LIVE_ENV_FILE) {
    throw new Error('set LIVE_ENV_FILE to a dotenv file with KEY and RPC_SEPOLIA')
  }
  const env = loadEnv(process.env.LIVE_ENV_FILE)
  if (!env.KEY || !env.RPC_SEPOLIA) {
    throw new Error(`${process.env.LIVE_ENV_FILE} needs KEY and RPC_SEPOLIA`)
  }
  const key = (env.KEY.startsWith('0x') ? env.KEY : `0x${env.KEY}`) as Hex
  const account = privateKeyToAccount(key)
  const chains: Record<number, { chain: Chain; rpc: string }> = {
    [sepolia.id]: { chain: sepolia, rpc: env.RPC_SEPOLIA },
    [arbitrumSepolia.id]: { chain: arbitrumSepolia, rpc: 'https://sepolia-rollup.arbitrum.io/rpc' },
  }
  let chainId: number = initialChainId
  const sent: SentTx[] = []
  const log: string[] = []

  async function rpc(method: string, params: unknown[]) {
    const res = await fetch(chains[chainId].rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const body = (await res.json()) as { result?: unknown; error?: { code: number; message: string } }
    if (body.error) {
      throw Object.assign(new Error(body.error.message), { code: body.error.code })
    }
    return body.result
  }

  async function handle({ method, params = [] }: WalletRequest): Promise<WalletResponse> {
    try {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return { result: [account.address] }
        case 'eth_chainId':
          return { result: numberToHex(chainId) }
        case 'wallet_requestPermissions':
        case 'wallet_getPermissions':
          return { result: [{ parentCapability: 'eth_accounts' }] }
        case 'wallet_switchEthereumChain': {
          const id = Number((params[0] as { chainId: string }).chainId)
          if (!chains[id]) {
            return { error: { code: 4902, message: `chain ${id} not in the live wallet` } }
          }
          chainId = id
          log.push(`switch ${id}`)
          return { result: null, chainChanged: numberToHex(id) }
        }
        case 'wallet_addEthereumChain':
          return { result: null }
        case 'eth_sendTransaction': {
          const tx = params[0] as { to: Hex; data?: Hex; value?: Hex; gas?: Hex }
          const client = createWalletClient({
            account,
            chain: chains[chainId].chain,
            transport: http(chains[chainId].rpc),
          })
          const value = tx.value ? BigInt(tx.value) : 0n
          const hash = await client.sendTransaction({
            to: tx.to,
            data: tx.data,
            value,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
          })
          sent.push({ chainId, hash, to: tx.to, value })
          log.push(`send ${chainId} ${tx.to} value=${value} -> ${hash}`)
          return { result: hash }
        }
        case 'personal_sign':
          return { result: await account.signMessage({ message: { raw: params[0] as Hex } }) }
        case 'eth_signTypedData_v4': {
          const data = typeof params[1] === 'string' ? JSON.parse(params[1] as string) : params[1]
          const { domain, types, primaryType, message } = data
          delete types.EIP712Domain
          log.push(`signTypedData ${primaryType}`)
          return { result: await account.signTypedData({ domain, types, primaryType, message }) }
        }
      }
      return { result: await rpc(method, params) }
    } catch (e) {
      const err = e as { code?: number; message?: string }
      log.push(`error ${method}: ${err.message}`)
      return { error: { code: err.code ?? -32603, message: err.message ?? String(e) } }
    }
  }

  async function install(page: Page) {
    await page.exposeFunction('__e2eWalletRequest', (request: WalletRequest) => handle(request))
    await page.addInitScript(
      ({ initialChainId }) => {
        type Listener = (...args: unknown[]) => void
        const listeners = new Map<string, Set<Listener>>()
        const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((fn) => fn(...args))
        const request = (window as unknown as { __e2eWalletRequest: (r: unknown) => Promise<WalletResponse> })
          .__e2eWalletRequest
        const provider = {
          isMetaMask: false,
          chainId: initialChainId as string,
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
      { initialChainId: numberToHex(chainId) },
    )
  }

  return { address: account.address, sent, log, install }
}
