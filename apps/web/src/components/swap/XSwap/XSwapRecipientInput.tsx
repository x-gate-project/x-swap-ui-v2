import { wagmiConfig } from 'components/Web3Provider/wagmi'
import { ErrorText, Muted, Row } from 'components/swap/XSwap/shared'
import { t } from 'i18n'
import { ChangeEvent, useCallback } from 'react'
import { AlertTriangle } from 'react-feather'
import {
  XSwapRecipientInput as ParsedRecipient,
  XSwapRecipientWarning,
  classifyXSwapRecipient,
  isSameXSwapAddress,
} from 'state/xswap/utils'
import styled, { useTheme } from 'styled-components'
import { useBalance, useBytecode, useTransactionCount } from 'wagmi'

type WagmiChainId = (typeof wagmiConfig)['chains'][number]['id']

const RECIPIENT_READ_STALE_MS = 5 * 60_000

const ToggleButton = styled.button`
  align-self: flex-start;
  padding: 4px 0;
  border: none;
  background: none;
  color: ${({ theme }) => theme.accent1};
  font-size: 14px;
  line-height: 20px;
  font-weight: 485;
  cursor: pointer;

  &:disabled {
    color: ${({ theme }) => theme.neutral3};
    cursor: default;
  }
`

const Panel = styled.div<{ $error: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 16px;
  border: 1px solid ${({ theme, $error }) => ($error ? theme.critical : 'transparent')};
  background: ${({ theme }) => theme.surface2};
`

const Input = styled.input`
  width: 100%;
  padding: 0;
  border: none;
  outline: none;
  background: none;
  color: ${({ theme }) => theme.neutral1};
  font-size: 16px;
  line-height: 24px;
  font-weight: 485;
  text-overflow: ellipsis;

  ::placeholder {
    color: ${({ theme }) => theme.neutral3};
  }

  &:disabled {
    color: ${({ theme }) => theme.neutral2};
  }
`

const FieldLabel = styled.label`
  color: ${({ theme }) => theme.neutral2};
  font-size: 14px;
  line-height: 20px;
`

const Warning = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: ${({ theme }) => theme.deprecated_accentWarning};
  font-size: 12px;
  line-height: 16px;
`

/**
 * Reads the recipient on the destination chain to warn about a contract or an unused address. A chain the wallet config
 * does not know is not read: every read would fail. A failed read is not retried and gives no warning.
 */
function useXSwapRecipientWarning(address?: string, chainId?: number): XSwapRecipientWarning | undefined {
  const known = Boolean(chainId && wagmiConfig.chains.some((chain) => chain.id === chainId))
  const query = {
    enabled: Boolean(address) && known,
    retry: false,
    staleTime: RECIPIENT_READ_STALE_MS,
    refetchOnWindowFocus: false,
  }
  const params = { address: address as `0x${string}` | undefined, chainId: chainId as WagmiChainId | undefined }
  const { data: code } = useBytecode({ ...params, query })
  const { data: nonce } = useTransactionCount({ ...params, query })
  const { data: balance } = useBalance({ ...params, query })
  return address && known ? classifyXSwapRecipient({ code, nonce, balance: balance?.value }) : undefined
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onChange: (value: string) => void
  parsed: ParsedRecipient
  /** The output's chain, where the recipient is paid. */
  chainId?: number
  chainName?: string
  outputSymbol?: string
  /** The connected wallet: typing it pays the wallet, as with no recipient. */
  swapper?: string
  /** An order is executing: the recipient cannot change. */
  disabled?: boolean
}

/**
 * Optional recipient of an x-swap output, behind a "Send to a different address" toggle. Closing it clears the address:
 * the output then goes to the connected wallet.
 */
export function XSwapRecipientInput({
  open,
  onOpenChange,
  value,
  onChange,
  parsed,
  chainId,
  chainName,
  outputSymbol,
  swapper,
  disabled,
}: Props) {
  const theme = useTheme()
  const recipient = parsed.status === 'valid' ? parsed.address : undefined
  // The wallet itself is quoted as no recipient: no warning and no "goes to this address" note.
  const isSelf = isSameXSwapAddress(recipient, swapper)
  const warning = useXSwapRecipientWarning(isSelf ? undefined : recipient, chainId)
  const chain = chainName || t('xswap.recipient.destinationChain')
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value.replace(/\s+/g, '')),
    [onChange],
  )
  const close = useCallback(() => {
    onChange('')
    onOpenChange(false)
  }, [onChange, onOpenChange])

  if (!open) {
    return (
      <ToggleButton
        type="button"
        disabled={disabled}
        onClick={() => onOpenChange(true)}
        data-testid="xswap-recipient-toggle"
      >
        {t('xswap.recipient.toggle')}
      </ToggleButton>
    )
  }

  const invalid = parsed.status === 'invalid'
  return (
    <Panel $error={invalid} data-testid="xswap-recipient">
      <Row>
        <FieldLabel htmlFor="xswap-recipient-input">{t('xswap.recipient.label')}</FieldLabel>
        <ToggleButton type="button" disabled={disabled} onClick={close} data-testid="xswap-recipient-remove">
          {t('xswap.recipient.remove')}
        </ToggleButton>
      </Row>
      <Input
        id="xswap-recipient-input"
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
        placeholder={t('xswap.recipient.placeholder')}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        aria-invalid={invalid}
        data-testid="xswap-recipient-input"
      />
      {invalid ? (
        <ErrorText style={{ fontSize: 12, lineHeight: '16px' }} data-testid="xswap-recipient-error">
          {t('xswap.recipient.invalid')}
        </ErrorText>
      ) : (
        warning && (
          <Warning data-testid={`xswap-recipient-warning-${warning}`}>
            <AlertTriangle size={14} color={theme.deprecated_accentWarning} style={{ flex: 'none' }} />
            {warning === 'contract'
              ? t('xswap.recipient.warning.contract', { chain, symbol: outputSymbol || t('xswap.recipient.output') })
              : t('xswap.recipient.warning.unused', { chain })}
          </Warning>
        )
      )}
      {recipient && <Muted>{isSelf ? t('xswap.recipient.self') : t('xswap.recipient.note')}</Muted>}
    </Panel>
  )
}
