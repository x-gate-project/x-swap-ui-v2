import { CurrencyAmount, Token } from '@uniswap/sdk-core'
import { AllowanceState, type Allowance } from 'hooks/usePermit2Allowance'
import { useAccount } from 'hooks/useAccount'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWalletClient, useConfig } from 'wagmi'
import { readContract } from 'wagmi/actions'
import Erc20Abi from 'lib/crossChain/abis/erc20.json'
import Permit2Abi from 'lib/crossChain/abis/permit2.json'
import { PERMIT2_ADDRESS } from 'lib/crossChain/constants'
import {
  ensurePermit2Approval,
  buildPermit2Data,
  encodeStoredPermit2Data,
} from 'lib/crossChain/permit2'
const EXPIRY_BUFFER = 300 // 5 min

export interface XChainSenderPermit2Result {
  allowance: Allowance
  /** Encoded permit2Data ready to pass into XChainSender.send() */
  permit2Data: `0x${string}` | undefined
  /** Ref updated synchronously inside permit() — safe to read in .then() callbacks */
  permit2DataRef: React.MutableRefObject<`0x${string}` | undefined>
  /** Sign EIP-712 permit — always callable regardless of allowance.state */
  permit: () => Promise<void>
  /** Re-fetch on-chain allowance state. Call this to retry after a failed refresh. */
  refresh: () => Promise<void>
}

/**
 * @param inputAmount  Token amount entering XChainSender (sell token)
 * @param spender      XChainSender contract address
 */
export function useXChainSenderPermit2(
  inputAmount: CurrencyAmount<Token> | undefined,
  spender: string | undefined,
): XChainSenderPermit2Result {
  const { address: account } = useAccount()
  const { data: walletClient } = useWalletClient()
  const wagmiConfig = useConfig()

  const token = inputAmount?.currency as Token | undefined
  const tokenAddr = token?.address as `0x${string}` | undefined
  const spenderAddr = spender as `0x${string}` | undefined
  const chainId = token?.chainId

  // ── On-chain state ──────────────────────────────────────────────────────────
  const [erc20Approved, setErc20Approved] = useState<boolean | undefined>(undefined)
  const [storedPermit, setStoredPermit] = useState<{
    amount: bigint
    expiration: number
    nonce: number
  } | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  // Refresh on-chain state
  const refresh = useCallback(async () => {
    if (!tokenAddr) {
      // No input token selected yet — genuinely nothing to query. Leave erc20Approved
      // as-is (undefined); the `allowance` memo guards on `!token` separately so this
      // doesn't cause a stuck LOADING state once a token is actually selected.
      setLoading(false)
      return
    }
    if (!account || !spenderAddr) {
      // Token known but account/spender not resolved yet. Resolve to "not approved"
      // rather than leaving erc20Approved at undefined — otherwise allowance stays
      // LOADING forever with nothing left to re-trigger this effect.
      setErc20Approved(false)
      setStoredPermit(undefined)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [erc20Allowance, permit2Result] = await Promise.all([
        readContract(wagmiConfig, {
          address: tokenAddr,
          abi: Erc20Abi,
          functionName: 'allowance',
          args: [account, PERMIT2_ADDRESS],
          chainId,
        }) as Promise<bigint>,
        readContract(wagmiConfig, {
          address: PERMIT2_ADDRESS,
          abi: Permit2Abi,
          functionName: 'allowance',
          args: [account, tokenAddr, spenderAddr],
          chainId,
        }) as Promise<[bigint, number, number]>,
      ])
      setErc20Approved(erc20Allowance > 0n)
      setStoredPermit({
        amount: permit2Result[0],
        expiration: permit2Result[1],
        nonce: permit2Result[2],
      })
    } catch {
      // RPC call failed (timeout/rate-limit/chain-switch race). Previously this left
      // erc20Approved at undefined with no retry mechanism → allowance stuck at LOADING
      // forever. Resolve to "not approved" so the UI can recover and let user retry.
      setErc20Approved(false)
      setStoredPermit(undefined)
    } finally {
      setLoading(false)
    }
  }, [tokenAddr, account, spenderAddr, chainId, wagmiConfig])

  useEffect(() => {
    refresh()
  }, [refresh])

  const rawAmount = inputAmount ? BigInt(inputAmount.quotient.toString()) : 0n
  const nowSec = Math.floor(Date.now() / 1000)

  const needsSetupApproval = erc20Approved === false
  const storedValid = useMemo(() => {
    if (!storedPermit) return false
    return storedPermit.amount >= rawAmount && storedPermit.expiration > nowSec + EXPIRY_BUFFER
  }, [storedPermit, rawAmount, nowSec])
  const needsPermitSignature = !storedValid

  const permit2DataRef = useRef<`0x${string}` | undefined>(undefined)
  const [permit2Data, setPermit2Data] = useState<`0x${string}` | undefined>(undefined)

  // Stored permit already valid on-chain (e.g. after page reload) → pre-fill permit2Data
  // synchronously without prompting the wallet, reusing the same skip-sign encoding as
  // buildPermit2Data's stored-allowance branch.
  useEffect(() => {
    if (storedValid && storedPermit && tokenAddr && spenderAddr && permit2DataRef.current === undefined) {
      const data = encodeStoredPermit2Data(tokenAddr, spenderAddr, storedPermit.amount, storedPermit.expiration, storedPermit.nonce)
      permit2DataRef.current = data
      setPermit2Data(data)
    }
  }, [storedValid, storedPermit, tokenAddr, spenderAddr])

  const approve = useCallback(async () => {
    if (!tokenAddr || !account) throw new Error('useXChainSenderPermit2: missing token/account')
    await ensurePermit2Approval(tokenAddr, account, wagmiConfig)
    await refresh()
  }, [tokenAddr, account, wagmiConfig, refresh])

  const permit = useCallback(async (): Promise<void> => {
    if (!tokenAddr || !spenderAddr || !account || !walletClient || !chainId || !rawAmount) {
      throw new Error('useXChainSenderPermit2: missing params for permit sign')
    }
    const data = await buildPermit2Data(
      tokenAddr,
      rawAmount,
      spenderAddr,
      account,
      chainId,
      walletClient,
      wagmiConfig,
    )
    permit2DataRef.current = data  // sync update — available immediately in .then()
    setPermit2Data(data)           // async update — triggers re-render for allowance state
    await refresh()
  }, [tokenAddr, spenderAddr, account, walletClient, chainId, rawAmount, wagmiConfig, refresh])

  const approveAndPermit = useCallback(async () => {
    await approve()
    await permit()
  }, [approve, permit])

  const revoke = useCallback(async () => {}, [])

  const allowance: Allowance = useMemo(() => {
    // No input token selected (also true transiently right after a successful tx, when
    // crossChainInputAmount gets reset to undefined upstream) — nothing left to allow, so
    // resolve to ALLOWED rather than LOADING. Returning LOADING here previously stuck the UI
    // in a permanent loading state post-success, since nothing re-triggers refresh() once
    // tokenAddr goes undefined (the effect below early-returns without touching erc20Approved).
    if (!token) {
      return { state: AllowanceState.ALLOWED }
    }

    if (loading || erc20Approved === undefined) {
      return { state: AllowanceState.LOADING }
    }


    // ALLOWED: no approval needed AND (permit2Data signed OR stored allowance valid)
    const isAllowed = !needsSetupApproval && (permit2Data !== undefined || storedValid)

    if (isAllowed) {
      return { state: AllowanceState.ALLOWED }
    }

    return {
      state: AllowanceState.REQUIRED,
      token: token!,
      isApprovalLoading: false,
      isApprovalPending: false,
      isRevocationPending: false,
      needsSetupApproval: needsSetupApproval ?? false,
      needsPermitSignature: needsPermitSignature && permit2Data === undefined,
      allowedAmount: inputAmount ?? CurrencyAmount.fromRawAmount(token!, 0),
      approve,
      permit,
      approveAndPermit,
      revoke,
    }
  }, [
    loading,
    erc20Approved,
    storedPermit,
    rawAmount,
    nowSec,
    needsSetupApproval,
    needsPermitSignature,
    permit2Data,
    token,
    inputAmount,
    approve,
    permit,
    approveAndPermit,
    revoke,
  ])

  return { allowance, permit2Data, permit2DataRef, permit, refresh }
}
