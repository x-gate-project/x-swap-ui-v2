import { ReactComponent as TestnetModeSvg } from 'assets/svg/testnet_mode.svg'
import { MenuState, miniPortfolioMenuStateAtom } from 'components/AccountDrawer/DefaultMenu'
import { useAccountDrawer } from 'components/AccountDrawer/MiniPortfolio/hooks'
import { showTestnetsAtom } from 'components/AccountDrawer/TestnetsToggle'
import { MouseoverTooltip } from 'components/Tooltip'
import { t } from 'i18n'
import { useAtomValue, useUpdateAtom } from 'jotai/utils'
import styled from 'styled-components'
import { opacify } from 'theme/utils'

// Kept out of TestnetsToggle.tsx: importing DefaultMenu there creates a cycle through i18n at load time.

const TestnetCard = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  cursor: pointer;
  border: 1px dashed ${({ theme }) => theme.success};
  border-radius: 6px;
  background: ${({ theme }) => opacify(12, theme.success)};
  color: ${({ theme }) => theme.success};

  &:hover {
    background: ${({ theme }) => opacify(20, theme.success)};
  }
`

const TestnetIcon = styled(TestnetModeSvg)`
  width: 14px;
  height: 14px;
`

// Navbar indicator so users don't mistake testnet balances/activity for mainnet.
export function TestnetModeBadge() {
  const showTestnets = useAtomValue(showTestnetsAtom)
  const accountDrawer = useAccountDrawer()
  const setMenu = useUpdateAtom(miniPortfolioMenuStateAtom)
  if (!showTestnets) {
    return null
  }
  const label = t('settings.testnetMode.tooltip')
  return (
    <MouseoverTooltip text={label} placement="bottom">
      <TestnetCard
        aria-label={label}
        data-testid="testnet-mode-badge"
        onClick={() => {
          // Set menu first so the drawer opens straight on Settings.
          setMenu(MenuState.SETTINGS)
          accountDrawer.open()
        }}
      >
        <TestnetIcon aria-hidden />
      </TestnetCard>
    </MouseoverTooltip>
  )
}
