import { MenuItem } from 'components/NavBar/CompanyMenu/Content'
import { useTabsVisible } from 'components/NavBar/ScreenSizes'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { useTheme } from 'styled-components'
import { FeatureFlags } from 'uniswap/src/features/gating/flags'
import { useFeatureFlag } from 'uniswap/src/features/gating/hooks'

export type TabsSection = {
  title: string
  href: string
  isActive?: boolean
  items?: TabsItem[]
  target?: string
  closeMenu?: () => void
}

export type TabsItem = MenuItem & {
  icon?: JSX.Element
  quickKey: string
  target?: string
}

export const useTabsContent = (): TabsSection[] => {
  const { t } = useTranslation()
  const isLegacyNav = !useFeatureFlag(FeatureFlags.NavRefresh)
  const forAggregatorEnabled = useFeatureFlag(FeatureFlags.ForAggregatorWeb)
  const { pathname } = useLocation()
  const theme = useTheme()
  const areTabsVisible = useTabsVisible()

  return isLegacyNav
    ? [
        {
          title: t('common.swap'),
          href: '/swap',
        },
        {
          title: t('common.explore'),
          href: '/explore',
        },
        {
          title: t('common.nfts'),
          href: '/nfts',
        },
      ]
    : [
        {
          title: t('common.transfer2'),
          href: 'https://www.x-gate.org/',
        },
        {
          title: t('common.swap'),
          href: '/swap',
          isActive: pathname.startsWith('/swap') || pathname.startsWith('/limit') || pathname.startsWith('/send'),
        },
        {
          title: t('common.pool'),
          href: '/pool',
          isActive: pathname.startsWith('/pool'),
        },
        {
          title: t('common.staking'),
          href: '',
          items: [
            {
              label: 'JOCX',
              quickKey: t(`quickKey.swap`),
              href: 'https://staker.x-swap.org/',
              internal: true,
              target: '_blank',
            },
          ]
        },
        {
          title: t('common.help'),
          href: 'https://docs.x-gate.org/',
          target: '_blank',
        },
        ...(!areTabsVisible
          ? [
              // {
              //   title: t('common.nfts'),
              //   href: '/nfts',
              // },
            ]
          : []),
      ]
}
