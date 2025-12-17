import { NavDropdown, NavDropdownTabWrapper } from 'components/NavBar/NavDropdown/index'
import { TabsItem, TabsSection, useTabsContent } from 'components/NavBar/Tabs/TabsContent'
import { useKeyPress } from 'hooks/useKeyPress'
import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { Popover, Text } from 'ui/src'
import { FeatureFlags } from 'uniswap/src/features/gating/flags'
import { useFeatureFlag } from 'uniswap/src/features/gating/hooks'

const ItemContainer = styled.div`
  display: flex;
  padding: 12px;
  align-items: center;
  gap: 8px;
  align-self: stretch;
  border-radius: 12px;
  background: ${({ theme }) => theme.surface2};
  cursor: pointer;
  :hover {
    background: ${({ theme }) => theme.surface3};
  }
`
const TabText = styled(Text)`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  &:hover {
    color: ${({ theme }) => theme.neutral1} !important;
  }
`
const QuickKey = styled.div`
  display: flex;
  width: 20px;
  height: 20px;
  padding: 0px 5px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 10px;
  border-radius: 4px;
  opacity: 0.54;
  background: ${({ theme }) => theme.surface3};
`

interface TItemProps {
  icon?: JSX.Element
  label: string
  quickKey: string
  path: string
  target?: string
  closeMenu: () => void
}
function Item({ icon, label, quickKey, path, target, closeMenu }: TItemProps) {
  const navHotkeysEnabled = useFeatureFlag(FeatureFlags.NavigationHotkeys)

  const itemContent = (
    <ItemContainer>
      {icon}
      <Text variant="buttonLabel2" width="100%" color="$neutral2">
        {label}
      </Text>
      {navHotkeysEnabled && (
        <QuickKey>
          <Text variant="body3" color="$neutral2">
            {quickKey}
          </Text>
        </QuickKey>
      )}
    </ItemContainer>
  )

  // If a target is provided, treat this as an external link (e.g. target="_blank")
  if (target) {
    return (
      <a
        href={path}
        target={target}
        rel={target === '_blank' ? 'noopener noreferrer' : undefined}
        style={{ textDecoration: 'none' }}
        onClick={closeMenu}
      >
        {itemContent}
      </a>
    )
  }

  return (
    <NavLink to={path} style={{ textDecoration: 'none' }} onClick={closeMenu}>
      {itemContent}
    </NavLink>
  )
}

const Tab = ({
  label,
  isActive,
  path,
  target,
  items,
}: {
  label: string
  isActive?: boolean
  path?: string
  target?: string
  items?: TabsItem[]
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const navigate = useNavigate()
  const popoverRef = useRef<Popover>(null)
  const location = useLocation()
  const navHotkeysEnabled = useFeatureFlag(FeatureFlags.NavigationHotkeys)

  const closeMenu = useCallback(() => {
    popoverRef.current?.close()
  }, [popoverRef])
  useEffect(() => closeMenu(), [location, closeMenu])

  const tabTextContent = (
    <TabText
      variant="subheading1"
      color={isActive || isOpen ? '$neutral1' : '$neutral2'}
      m="8px"
      gap="4px"
      cursor="pointer"
      userSelect="none"
    >
      {label}
    </TabText>
  )

  const Label = path ? (
    // If a target is provided, open as a regular link (likely external)
    target ? (
      <a
        href={path}
        target={target}
        rel={target === '_blank' ? 'noopener noreferrer' : undefined}
        style={{ textDecoration: 'none' }}
      >
        {tabTextContent}
      </a>
    ) : (
      <NavLink to={path} style={{ textDecoration: 'none' }}>
        {tabTextContent}
      </NavLink>
    )
  ) : (
    tabTextContent
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!items || !isOpen) {
        return
      }
      const item = items.find((i) => i.quickKey.toUpperCase() === event.key || i.quickKey.toLowerCase() === event.key)
      if (!item) {
        return
      }
      if (item.internal) {
        navigate(item.href)
      } else {
        window.location.href = item.href
      }
      closeMenu()
    },
    [items, navigate, closeMenu, isOpen],
  )

  useKeyPress({
    callback: handleKeyDown,
    keys: items?.map((i) => i.quickKey.toLowerCase()),
    disabled: !navHotkeysEnabled || !isOpen,
  })

  if (!items) {
    return Label
  }

  return (
    <Popover ref={popoverRef} placement="bottom" hoverable stayInFrame allowFlip onOpenChange={setIsOpen}>
      <Popover.Trigger>{Label}</Popover.Trigger>
      <NavDropdown isOpen={isOpen}>
        <NavDropdownTabWrapper>
          {items.map((item, index) => (
            <Item
              key={`${item.label}_${index}`}
              icon={item.icon}
              label={item.label}
              quickKey={item.quickKey}
              path={item.href}
              target={item.target}
              closeMenu={closeMenu}
            />
          ))}
        </NavDropdownTabWrapper>
      </NavDropdown>
    </Popover>
  )
}

export function Tabs() {
  const tabsContent: TabsSection[] = useTabsContent()
  return (
    <>
      {tabsContent.map(({ title, isActive, href, target, items }, index) => (
        <Tab key={`${title}_${index}`} label={title} isActive={isActive} path={href} items={items} target={target} />
      ))}
    </>
  )
}
