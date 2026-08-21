import {
  encodeAbiParameters,
  parseAbiParameters,
  maxUint160,
  type WalletClient,
} from 'viem'

import { readContract, writeContract, waitForTransactionReceipt } from 'wagmi/actions'
import type { Config } from 'wagmi'
import Erc20Abi from 'lib/crossChain/abis/erc20.json'
import Permit2Abi from 'lib/crossChain/abis/permit2.json'
import {
  PERMIT2_ADDRESS,
  PERMIT_DETAILS_TYPE,
  PERMIT_SINGLE_TYPE,
} from './constants'

export async function ensurePermit2Approval(
  token: `0x${string}`,
  account: `0x${string}`,
  wagmiConfig: Config,
): Promise<void> {
  const currentAllowance = await readContract(wagmiConfig, {
    address: token,
    abi: Erc20Abi,
    functionName: 'allowance',
    args: [account, PERMIT2_ADDRESS],
  }) as bigint

  if (currentAllowance === 0n) {
    const tx = await writeContract(wagmiConfig, {
      address: token,
      abi: Erc20Abi,
      functionName: 'approve',
      args: [PERMIT2_ADDRESS, maxUint160],
    })
    await waitForTransactionReceipt(wagmiConfig, { hash: tx })
  }
}

const PERMIT2_DATA_TUPLE =
  '(((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature)'

/**
 * Sync-encode permit2Data from an already-valid stored on-chain permit — no wallet signature needed.
 * Contract: permit() call will fail (nonce already used) but is ignored, then transferFrom()
 * succeeds using the stored allowance. Used both by buildPermit2Data (skip-sign path) and by
 * useXChainSenderPermit2 to pre-fill permit2Data on load when a valid permit already exists.
 */
export function encodeStoredPermit2Data(
  token: `0x${string}`,
  spender: `0x${string}`,
  storedAmount: bigint,
  storedExpiration: number,
  nonce: number,
): `0x${string}` {
  const sigDeadline = BigInt(Math.floor(Date.now() / 1000) + 600)
  return encodeAbiParameters(parseAbiParameters(PERMIT2_DATA_TUPLE), [{
    permitSingle: {
      details: { token, amount: storedAmount, expiration: storedExpiration, nonce },
      spender,
      sigDeadline,
    },
    signature: '0x',
  }])
}

export async function buildPermit2Data(
  token: `0x${string}`,
  amount: bigint,
  spender: `0x${string}`,
  account: `0x${string}`,
  chainId: number,
  walletClient: WalletClient,
  wagmiConfig: Config,
): Promise<`0x${string}`> {
  const allowanceResult = await readContract(wagmiConfig, {
    address: PERMIT2_ADDRESS,
    abi: Permit2Abi,
    functionName: 'allowance',
    args: [account, token, spender],
  }) as [bigint, number, number]

  const [storedAmount, storedExpiration, nonce] = allowanceResult
  const nowSec = Math.floor(Date.now() / 1000)
  // Buffer: 5 min — if allowance expires within 5 min, re-sign
  const EXPIRY_BUFFER = 300

  // Stored allowance sufficient and not expiring soon → skip sign
  if (storedAmount >= amount && storedExpiration > nowSec + EXPIRY_BUFFER) {
    return encodeStoredPermit2Data(token, spender, storedAmount, storedExpiration, Number(nonce))
  }

  // Need to sign: use maxUint160 amount + 30 day expiration (match same-chain permit)
  const expiration = nowSec + 30 * 24 * 3600 // 30 days
  const sigDeadline = BigInt(nowSec + 30 * 60) // tx deadline: 30 min

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: 'Permit2',
      chainId,
      verifyingContract: PERMIT2_ADDRESS,
    },
    types: {
      PermitDetails: PERMIT_DETAILS_TYPE,
      PermitSingle:  PERMIT_SINGLE_TYPE,
    },
    primaryType: 'PermitSingle',
    message: {
      details: {
        token,
        amount: maxUint160,
        expiration,
        nonce: Number(nonce),
      },
      spender,
      sigDeadline,
    },
  })

  return encodeAbiParameters(
    parseAbiParameters(PERMIT2_DATA_TUPLE),
    [{
      permitSingle: {
        details: { token, amount: maxUint160, expiration, nonce: Number(nonce) },
        spender,
        sigDeadline,
      },
      signature,
    }],
  )
}
