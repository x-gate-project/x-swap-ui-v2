import { ButtonPrimary } from 'components/Button'
import Loader from 'components/Icons/LoadingSpinner'
import { wagmiConfig } from 'components/Web3Provider/wagmi'
import { XSwapQuoteRoutes, xswapRoutes } from 'components/swap/XSwap/XSwapQuoteRoutes'
import { Card, ErrorText, Label, Muted, Row, TxLink } from 'components/swap/XSwap/shared'
import useSelectChain from 'hooks/useSelectChain'
import { t } from 'i18n'
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Text } from 'rebass'
import { XSwapApiError, refreshXSwapQuote, registerXSwapOrder } from 'state/xswap/client'
import { getXSwapErrorMessage, toXSwapError } from 'state/xswap/errors'
import {
  XSwapExecutionDeps,
  XSwapPlanError,
  XSwapQuoteExpiredError,
  XSwapRegisterError,
  XSwapStep,
  XSwapTxRevertedError,
  executeXSwapQuote,
} from 'state/xswap/execute'
import { XSwapTokenLookup, useXSwapRequote } from 'state/xswap/hooks'
import { XSwapOrder, XSwapQuote, XSwapQuoteResponse, XSwapTx, XSwapTxKind } from 'state/xswap/types'
import styled from 'styled-components'
import { InterfaceChainId } from 'uniswap/src/types/chains'
import { logger } from 'utilities/src/logger/logger'
import { didUserReject } from 'utils/swapErrorToUserReadableMessage'
import { getAccount, sendTransaction, waitForTransactionReceipt } from 'wagmi/actions'

type WagmiChainId = (typeof wagmiConfig)['chains'][number]['id']

const Steps = styled.ol`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Dot = styled.span<{ $status: XSwapStep['status'] }>`
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme, $status }) =>
    $status === 'done'
      ? theme.success
      : $status === 'error'
        ? theme.critical
        : $status === 'pending'
          ? theme.surface3
          : theme.accent1};
`

function stepLabel(kind: XSwapTxKind): string {
  switch (kind) {
    case 'approve-reset':
      return t('xswap.execute.step.approveReset')
    case 'approve':
      return t('xswap.execute.step.approve')
    case 'permit2-approve':
      return t('xswap.execute.step.permit2Approve')
    case 'deposit':
      return t('xswap.execute.step.deposit')
  }
}

/** Sends txs from the connected wallet through wagmi, switching to the tx's chain first. */
function useXSwapExecutionDeps(): XSwapExecutionDeps {
  const selectChain = useSelectChain()
  return useMemo(
    () => ({
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      refreshQuote: (quoteId) => refreshXSwapQuote(quoteId),
      registerOrder: (params) => registerXSwapOrder(params),
      sendTx: async (tx: XSwapTx) => {
        if (getAccount(wagmiConfig).chainId !== tx.chainId) {
          const switched = await selectChain(tx.chainId as InterfaceChainId)
          if (!switched) {
            throw new Error(t('xswap.execute.error.switchChain'))
          }
        }
        return sendTransaction(wagmiConfig, {
          chainId: tx.chainId as WagmiChainId,
          to: tx.to as `0x${string}`,
          data: tx.data as `0x${string}`,
          value: BigInt(tx.value),
          gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
        })
      },
      waitForTx: async (chainId, hash) => {
        const receipt = await waitForTransactionReceipt(wagmiConfig, {
          chainId: chainId as WagmiChainId,
          hash: hash as `0x${string}`,
        })
        return receipt.status === 'success'
      },
    }),
    [selectChain],
  )
}

type ExecutionError = { message: string; depositHash?: { chainId: number; hash: string } }

function toExecutionError(error: unknown, chainId: number): ExecutionError {
  if (didUserReject(error)) {
    return { message: t('xswap.execute.error.rejected') }
  }
  if (error instanceof XSwapQuoteExpiredError) {
    return { message: t('xswap.execute.error.quoteExpired') }
  }
  if (error instanceof XSwapTxRevertedError) {
    return { message: t('xswap.execute.error.reverted') }
  }
  if (error instanceof XSwapPlanError) {
    return { message: t('xswap.execute.error.invalidPlan') }
  }
  if (error instanceof XSwapRegisterError) {
    return { message: t('xswap.execute.error.register'), depositHash: { chainId, hash: error.txHash } }
  }
  if (error instanceof XSwapApiError) {
    return { message: getXSwapErrorMessage(toXSwapError(error)) }
  }
  return { message: t('xswap.execute.error.generic') }
}

type Props = {
  response: XSwapQuoteResponse
  lookup: XSwapTokenLookup
  /** A background re-quote is in flight; the routes shown are still valid. */
  refreshing?: boolean
  /** Provider of the route the user picked; `best` when unset or no longer offered. */
  selectedProvider?: string
  onSelectProvider: (provider: string) => void
  /** Why the swap cannot go on (no wallet, no balance, …); shown on the button. */
  inputError?: ReactNode
  onExecutingChange: (executing: boolean) => void
  onOrder: (order: XSwapOrder) => void
}

/**
 * Cross-chain order flow for every route class but `local`: pick a route, then send its approvals and deposit in
 * order and register the order. A priced-only route (`executable: false`) has nothing to sign, so no button.
 */
export function XSwapCrossChainPanel({
  response,
  lookup,
  refreshing,
  selectedProvider,
  onSelectProvider,
  inputError,
  onExecutingChange,
  onOrder,
}: Props) {
  const deps = useXSwapExecutionDeps()
  const requote = useXSwapRequote()
  const routes = useMemo(() => xswapRoutes(response.best, response.candidates), [response])
  const selected = routes.find((q) => q.provider === selectedProvider) ?? response.best

  // While executing, the quote being sent is pinned (it may be refreshed) and the route list is frozen.
  const [executing, setExecuting] = useState<XSwapQuote>()
  const [steps, setSteps] = useState<XSwapStep[]>()
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState<ExecutionError>()
  const quote = executing ?? selected

  // Another amount, pair or route drops the previous attempt's progress and error; a re-quote of the same one does not.
  const attemptKey = [
    selected.provider,
    selected.tokenIn.chainId,
    selected.tokenIn.address,
    selected.tokenOut.chainId,
    selected.tokenOut.address,
    selected.inputAmount,
  ].join('|')
  useEffect(() => {
    setSteps(undefined)
    setError(undefined)
  }, [attemptKey])

  useEffect(() => onExecutingChange(Boolean(executing)), [executing, onExecutingChange])

  const execute = useCallback(async () => {
    setExecuting(selected)
    setError(undefined)
    setSteps(undefined)
    setRegistering(false)
    try {
      const order = await executeXSwapQuote(selected, deps, {
        onQuote: setExecuting,
        onPlan: setSteps,
        onStep: (index, patch) =>
          setSteps((current) => current?.map((step, i) => (i === index ? { ...step, ...patch } : step))),
        onRegistering: () => setRegistering(true),
      })
      setSteps(undefined)
      onOrder(order)
    } catch (e) {
      logger.warn('XSwapCrossChainPanel', 'execute', 'cross-chain order failed', e)
      setSteps((current) => current?.map((step) => (step.status === 'active' ? { ...step, status: 'error' } : step)))
      setError(toExecutionError(e, selected.tokenIn.chainId))
      if (e instanceof XSwapQuoteExpiredError) {
        requote()
      }
    } finally {
      setExecuting(undefined)
      setRegistering(false)
    }
  }, [deps, onOrder, requote, selected])

  const busy = Boolean(executing)

  return (
    <Card data-testid="xswap-cross-chain">
      <Row>
        <Label>{t('xswap.route.title')}</Label>
        <Row>
          {refreshing && !busy && (
            <Row data-testid="xswap-quote-refreshing">
              <Loader size="12px" />
              <Muted>{t('xswap.route.refreshing')}</Muted>
            </Row>
          )}
          <Muted>{response.routeClass}</Muted>
        </Row>
      </Row>
      <XSwapQuoteRoutes
        routes={busy ? [quote] : routes}
        bestQuoteId={response.best.quoteId}
        selectedQuoteId={quote.quoteId}
        onSelect={(q) => onSelectProvider(q.provider)}
        lookup={lookup}
        disabled={busy}
      />

      {steps && (
        <Steps data-testid="xswap-execute-steps">
          {steps.map((step, i) => (
            <li key={i}>
              <Row style={{ justifyContent: 'flex-start' }}>
                <Dot $status={step.status} />
                <Label>
                  {i + 1}. {stepLabel(step.tx.kind)}
                </Label>
                {step.hash && <TxLink chainId={step.tx.chainId} hash={step.hash} />}
              </Row>
            </li>
          ))}
        </Steps>
      )}
      {registering && <Muted>{t('xswap.execute.registering')}</Muted>}

      {error && (
        <ErrorText data-testid="xswap-execute-error">
          {error.message}
          {error.depositHash && (
            <>
              {' '}
              <TxLink chainId={error.depositHash.chainId} hash={error.depositHash.hash} />
            </>
          )}
        </ErrorText>
      )}

      {!quote.executable ? (
        // Priced only: contracts are not deployed on this route yet, there is nothing to sign.
        <Muted data-testid="xswap-quote-only">{t('xswap.execute.quoteOnly')}</Muted>
      ) : (
        <ButtonPrimary
          $borderRadius="16px"
          disabled={busy || Boolean(inputError)}
          onClick={execute}
          data-testid="xswap-execute-button"
        >
          <Row style={{ justifyContent: 'center' }}>
            {busy && !inputError && <Loader size="20px" />}
            <Text fontSize={20}>
              {inputError ??
                (busy ? t('xswap.execute.inProgress') : error ? t('common.tryAgain.error') : t('common.swap'))}
            </Text>
          </Row>
        </ButtonPrimary>
      )}
    </Card>
  )
}
