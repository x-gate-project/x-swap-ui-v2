import { Bag } from 'components/NavBar/Bag'
import { ChainSelector } from 'components/NavBar/ChainSelector'
import { GetTheAppButton } from 'components/NavBar/DownloadApp/GetTheAppButton'
import Blur from 'components/NavBar/LEGACY/Blur'
import { SearchBar } from 'components/NavBar/LEGACY/SearchBar/SearchBar'
import * as styles from 'components/NavBar/LEGACY/style.css'
import Web3Status from 'components/Web3Status'
import { useIsLandingPage } from 'hooks/useIsLandingPage'
import { useIsLimitPage } from 'hooks/useIsLimitPage'
import { useIsNftPage } from 'hooks/useIsNftPage'
import { useIsPoolsPage } from 'hooks/useIsPoolsPage'
import { useIsSendPage } from 'hooks/useIsSendPage'
import { useIsSwapPage } from 'hooks/useIsSwapPage'
import { Trans } from 'i18n'
import { Box } from 'nft/components/Box'
import { Row } from 'nft/components/Flex'
import { useProfilePageState } from 'nft/hooks'
import { useIsNavSearchInputVisible } from 'nft/hooks/useIsNavSearchInputVisible'
import { ProfilePageStateType } from 'nft/types'
import { ReactNode } from 'react'
import { NavLink, NavLinkProps, useLocation } from 'react-router-dom'
import styled from 'styled-components'
import { Z_INDEX } from 'theme/zIndex'
import { FeatureFlags } from 'uniswap/src/features/gating/flags'
import { useFeatureFlag } from 'uniswap/src/features/gating/hooks'

const Nav = styled.nav`
  position: relative;
  padding: ${({ theme }) => `${theme.navVerticalPad}px 12px`};
  width: 100%;
  height: ${({ theme }) => theme.navHeight}px;
  z-index: ${Z_INDEX.sticky};
`

interface MenuItemProps {
  href: string
  id?: NavLinkProps['id']
  isActive?: boolean
  children: ReactNode
  dataTestId?: string
  target?: string
}

const MenuItem = ({ href, dataTestId, id, isActive, children, target }: MenuItemProps) => {
  const className = isActive ? styles.activeMenuItem : styles.menuItem
  const commonProps = {
    className,
    id,
    style: { textDecoration: 'none' as const },
    'data-testid': dataTestId,
  }

  if (target) {
    return (
      <a
        href={href}
        target={target}
        rel={target === '_blank' ? 'noopener noreferrer' : undefined}
        {...commonProps}
      >
        {children}
      </a>
    )
  }

  return (
    <NavLink to={href} {...commonProps}>
      {children}
    </NavLink>
  )
}

export const PageTabs = () => {
  const { pathname } = useLocation()

  const isPoolActive = useIsPoolsPage()

  return (
    <>
      <MenuItem href="https://www.x-gate.org/">
        <Trans i18nKey="common.transfer2" />
      </MenuItem>
      <MenuItem href="/swap" isActive={pathname.startsWith('/swap')}>
        <Trans i18nKey="common.swap" />
      </MenuItem>
      <Box display={{ sm: 'flex', lg: 'none', xxl: 'flex' }} width="full">
        <MenuItem href="/pool" dataTestId="pool-nav-link" isActive={isPoolActive}>
          <Trans i18nKey="common.pool" />
        </MenuItem>
      </Box>
      <MenuItem href="https://staker.x-swap.org/" target="_blank">
        <Trans i18nKey="common.staking" />
      </MenuItem>
      <MenuItem href="https://docs.x-gate.org/" target="_blank">
        <Trans i18nKey="common.help" />
      </MenuItem>
    </>
  )
}

const LegacyNavbar = ({ blur }: { blur: boolean }) => {
  const isNftPage = useIsNftPage()
  const isSwapPage = useIsSwapPage()
  const isSendPage = useIsSendPage()
  const isLimitPage = useIsLimitPage()
  const isLandingPage = useIsLandingPage()
  const sellPageState = useProfilePageState((state) => state.state)
  const isNavSearchInputVisible = useIsNavSearchInputVisible()
  const multichainUXEnabled = useFeatureFlag(FeatureFlags.MultichainUX)

  const hideChainSelector = multichainUXEnabled ? isSendPage || isSwapPage || isLimitPage || isNftPage : isNftPage

  return (
    <>
      {blur && <Blur />}
      <Nav>
        <Box display="flex" height="full" flexWrap="nowrap">
          <Box className={styles.leftSideContainer}>
            {hideChainSelector ? null : (
              <Box display={{ sm: 'flex', lg: 'none' }}>
                <ChainSelector leftAlign={true} />
              </Box>
            )}
            <Row display={{ sm: 'none', lg: 'flex' }}>
              <PageTabs />
            </Row>
          </Box>
          {/* <Box
            data-cy="center-search-container"
            className={styles.searchContainer}
            {...(isNavSearchInputVisible && {
              display: 'flex',
            })}
          >
            <SearchBar />
          </Box> */}
          <Box className={styles.rightSideContainer}>
            <Row gap="12">
              {/* <Box
                data-cy="right-search-container"
                position="relative"
                display={isNavSearchInputVisible ? 'none' : { sm: 'flex' }}
              >
                <SearchBar />
              </Box> */}
              {isNftPage && sellPageState !== ProfilePageStateType.LISTING && <Bag />}
              {hideChainSelector ? null : (
                <Box display={{ sm: 'none', lg: 'flex' }}>
                  <ChainSelector />
                </Box>
              )}
              {isLandingPage && <GetTheAppButton />}
              <Web3Status />
            </Row>
          </Box>
        </Box>
      </Nav>
    </>
  )
}

export default LegacyNavbar
