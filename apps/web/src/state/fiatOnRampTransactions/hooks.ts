import { useAccount } from 'hooks/useAccount'
import { useMemo } from 'react'
import { useAppSelector } from 'state/hooks'

export function useFiatOnRampTransactions() {
  const account = useAccount()
  const fiatOnRampTransactions = useAppSelector((state) => state.fiatOnRampTransactions)
  return useMemo(() => {
    // Only compute the transactions if there's a valid account address
    if (!account.address || !fiatOnRampTransactions[account.address]) {
      return {}
    }
    return fiatOnRampTransactions[account.address]
  }, [account.address, fiatOnRampTransactions])
}
