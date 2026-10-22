/**
 * useCrossChainConfirmModalState
 *
 * Mirrors useConfirmModalState but for cross-chain (XChainSender) flow:
 *   - No InterfaceTrade required
 *   - spender = XChainSender address (not Universal Router)
 *   - Steps: APPROVING_TOKEN → PERMITTING → PENDING_CONFIRMATION
 *   - No WRAPPING step
 */

import { CurrencyAmount, Token } from '@uniswap/sdk-core'
import { ConfirmModalState } from 'components/ConfirmSwapModal'
import { PendingModalError } from 'components/ConfirmSwapModal/Error'
import { useCallback, useEffect, useState } from 'react'
import { AllowanceState } from 'hooks/usePermit2Allowance'
import { useXChainSenderPermit2 } from 'hooks/useXChainSenderPermit2'
import usePrevious from 'hooks/usePrevious'
import { didUserReject } from 'utils/swapErrorToUserReadableMessage'
import { logger } from 'utilities/src/logger/logger'

type CrossChainPendingStep = Extract<
  ConfirmModalState,
  | ConfirmModalState.APPROVING_TOKEN
  | ConfirmModalState.PERMITTING
  | ConfirmModalState.PENDING_CONFIRMATION
>

export function useCrossChainConfirmModalState({
  inputAmount,
  spender,
  onCrossChainHandle,
}: {
  /** Token amount entering the bridge/XChainSender */
  inputAmount: CurrencyAmount<Token> | undefined
  /** XChainSender contract address — spender for Permit2 */
  spender: string | undefined
  /** Callback to execute the bridge tx (after approve + permit). Receives permit2Data. */
  onCrossChainHandle: (permit2Data: `0x${string}` | undefined) => void
}) {
  const [confirmModalState, setConfirmModalState] = useState<ConfirmModalState>(ConfirmModalState.REVIEWING)
  const [approvalError, setApprovalError] = useState<PendingModalError>()
  const [pendingModalSteps, setPendingModalSteps] = useState<CrossChainPendingStep[]>([])

  const { allowance, permit2Data, permit2DataRef, permit: signPermit } = useXChainSenderPermit2(inputAmount, spender)

  const generateRequiredSteps = useCallback((): CrossChainPendingStep[] => {
    const steps: CrossChainPendingStep[] = []
    if (allowance.state === AllowanceState.REQUIRED && allowance.needsSetupApproval) {
      steps.push(ConfirmModalState.APPROVING_TOKEN)
    }
    // Always require permit sign if permit2Data not yet available in this session,
    // even if stored on-chain permit is still valid — we need the encoded permit2Data bytes
    // to pass into XChainSender.send(). Stored permit is valid on-chain but we can't
    // reconstruct the encoded bytes without re-signing.
    // Guard with !!inputAmount: native-token bridge has no ERC20 input (inputAmount undefined),
    // so permit2DataRef.current never gets set — without this guard, needsPermit was always
    // true and PERMITTING got pushed even though there's nothing to permit.
    const needsPermit =
      (allowance.state === AllowanceState.REQUIRED && allowance.needsPermitSignature) ||
      (!!inputAmount && permit2DataRef.current === undefined)

    if (needsPermit) {
      steps.push(ConfirmModalState.PERMITTING)
    }
    steps.push(ConfirmModalState.PENDING_CONFIRMATION)
    return steps
  }, [allowance, permit2DataRef, inputAmount])


  const catchUserReject = useCallback(async (e: any, errorType: PendingModalError) => {
    setConfirmModalState(ConfirmModalState.REVIEWING)
    if (didUserReject(e)) return
    logger.warn('useCrossChainConfirmModalState', 'catchUserReject', 'Step failed', { error: e })
    setApprovalError(errorType)
  }, [])

  const performStep = useCallback(
    async (step: ConfirmModalState) => {
      switch (step) {
        case ConfirmModalState.APPROVING_TOKEN:
          setConfirmModalState(ConfirmModalState.APPROVING_TOKEN)
          if (allowance.state !== AllowanceState.REQUIRED) break
          allowance.approve().catch((e) => catchUserReject(e, PendingModalError.TOKEN_APPROVAL_ERROR))
          break

        case ConfirmModalState.PERMITTING: {
          setConfirmModalState(ConfirmModalState.PERMITTING)
          // Use signPermit directly from hook — always callable regardless of allowance.state
          // (allowance.permit only exists when state === REQUIRED)
          signPermit()
            .then(() => {
              // permit2DataRef is updated synchronously inside permit() before it resolves
              onCrossChainHandle(permit2DataRef.current)
              setConfirmModalState(ConfirmModalState.PENDING_CONFIRMATION)
            })
            .catch((e) => catchUserReject(e, PendingModalError.TOKEN_APPROVAL_ERROR))
          break
        }

        case ConfirmModalState.PENDING_CONFIRMATION:
          setConfirmModalState(ConfirmModalState.PENDING_CONFIRMATION)
          try {
            onCrossChainHandle(permit2DataRef.current)
          } catch (e) {
            catchUserReject(e, PendingModalError.CONFIRMATION_ERROR)
          }
          break

        default:
          setConfirmModalState(ConfirmModalState.REVIEWING)
      }
    },
    [allowance, catchUserReject, onCrossChainHandle, permit2DataRef, signPermit],
  )

  const startBridgeFlow = useCallback(() => {
    const steps = generateRequiredSteps()
    setPendingModalSteps(steps)
    performStep(steps[0])
  }, [generateRequiredSteps, performStep])

  // After approve confirmed → auto-advance to permit
  const previousSetupApprovalNeeded = usePrevious(
    allowance.state === AllowanceState.REQUIRED ? allowance.needsSetupApproval : undefined,
  )
  useEffect(() => {
    if (
      allowance.state === AllowanceState.REQUIRED &&
      allowance.needsPermitSignature &&
      !allowance.needsSetupApproval &&
      previousSetupApprovalNeeded
    ) {
      performStep(ConfirmModalState.PERMITTING)
    }
  }, [allowance, performStep, previousSetupApprovalNeeded])

  // After approve+permit done → auto-advance to bridge tx
  // NOTE: PERMITTING case handles its own advance (calls onBridge directly after permit resolves)
  // This effect only handles edge case: allowance already ALLOWED when entering approval phase
  // AND permit2DataRef already has data (signed in this session)
  const isInApprovalPhase = confirmModalState === ConfirmModalState.APPROVING_TOKEN

  useEffect(() => {
    if (isInApprovalPhase && allowance.state === AllowanceState.ALLOWED && permit2DataRef.current !== undefined) {
      // Allowance sufficient AND permit2Data ready — go straight to bridge
      onCrossChainHandle(permit2DataRef.current)
      setConfirmModalState(ConfirmModalState.PENDING_CONFIRMATION)
    }
  }, [allowance.state, isInApprovalPhase, onCrossChainHandle, permit2DataRef])

  const resetToReviewScreen = () => {
    setConfirmModalState(ConfirmModalState.REVIEWING)
  }

  const onCancel = () => {
    setConfirmModalState(ConfirmModalState.REVIEWING)
    setApprovalError(undefined)
  }

  return {
    startBridgeFlow,
    resetToReviewScreen,
    onCancel,
    confirmModalState,
    approvalError,
    pendingModalSteps,
    allowance,
    permit2Data,
  }
}
