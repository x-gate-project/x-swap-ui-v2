import Modal from 'components/Modal'
import { XSwapOrderTracker } from 'components/swap/XSwap/XSwapOrderTracker'
import { atom } from 'jotai'
import { useAtomValue, useUpdateAtom } from 'jotai/utils'
import { useCallback } from 'react'
import { XSwapOrder } from 'state/xswap/types'

const selectedXSwapOrderAtom = atom<XSwapOrder | undefined>(undefined)

export function useOpenXSwapOrderModal(): (order: XSwapOrder) => void {
  const setOrder = useUpdateAtom(selectedXSwapOrderAtom)
  return useCallback((order: XSwapOrder) => setOrder(order), [setOrder])
}

/** Live status of a cross-chain order opened from the Activity tab. */
export function XSwapOrderModal() {
  const order = useAtomValue(selectedXSwapOrderAtom)
  const setOrder = useUpdateAtom(selectedXSwapOrderAtom)
  const close = useCallback(() => setOrder(undefined), [setOrder])

  return (
    <Modal maxWidth={420} isOpen={!!order} onDismiss={close}>
      {order && <XSwapOrderTracker order={order} onClose={close} />}
    </Modal>
  )
}
