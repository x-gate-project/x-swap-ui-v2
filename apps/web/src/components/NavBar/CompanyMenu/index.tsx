import { useIsTouchDevice } from '@tamagui/core'
import { ArrowChangeDown } from 'components/Icons/ArrowChangeDown'
import { MenuDropdown } from 'components/NavBar/CompanyMenu/MenuDropdown'
import { MobileMenuDrawer } from 'components/NavBar/CompanyMenu/MobileMenuDrawer'
import { useIsMobileDrawer, useTabsVisible } from 'components/NavBar/ScreenSizes'
import { useScreenSize } from 'hooks/screenSize'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { Popover } from 'ui/src'
import { Hamburger } from 'ui/src/components/icons'

const ArrowDown = styled(ArrowChangeDown)<{ $isActive: boolean }>`
  height: 100%;
  color: ${({ $isActive, theme }) => ($isActive ? theme.neutral1 : theme.neutral2)};
`
const Trigger = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  cursor: pointer;
  &:hover {
    ${ArrowDown} {
      color: ${({ theme }) => theme.neutral1} !important;
    }
  }
`
const UniIcon = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

export function CompanyMenu() {
  const popoverRef = useRef<Popover>(null)
  const isSmallScreen = !useScreenSize()['sm']
  const isMobileDrawer = useIsMobileDrawer()
  const isLargeScreen = useScreenSize()['xl']
  const location = useLocation()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const areTabsVisible = useTabsVisible()

  const closeMenu = useCallback(() => {
    popoverRef.current?.close()
  }, [popoverRef])
  useEffect(() => closeMenu(), [location, closeMenu])

  const handleLogoClick = useCallback(() => {
    navigate({
      pathname: '/',
      search: '?intro=true',
    })
  }, [navigate])
  const isTouchDevice = useIsTouchDevice()

  return (
    <>
      {!areTabsVisible && (
        <Popover ref={popoverRef} placement="bottom" hoverable stayInFrame allowFlip onOpenChange={setIsOpen}>
          <Popover.Trigger>
            <Trigger>
              <Hamburger size={22} color="$neutral2" cursor="pointer" />
              <ArrowDown $isActive={isOpen} width="12px" height="12px" />
            </Trigger>
          </Popover.Trigger>
          {isMobileDrawer ? (
            <MobileMenuDrawer isOpen={isOpen} closeMenu={closeMenu} />
          ) : (
            <MenuDropdown close={closeMenu} />
          )}
        </Popover>
      )}
    </>
  )
}
